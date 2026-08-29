/**
 * 原則4「機械強制」/ §5「policy-as-test」の「CI の構造」検証。
 *
 * このファイルは 2 つの検証を持つ。
 *
 * ① ゲート構造: ゲートジョブが存在し、同一 workflow ファイル内の他の全
 * ジョブが `needs` (直接・間接を問わない)でそれに依存していることを検証
 * する。これにより、ジョブが増えてもゲートを迂回できない(新しいジョブを
 * 追加してもゲート未依存のまま main にマージされる、という迂回を構造的に
 * 防ぐ)。
 *
 * ゲートジョブの識別は「`mise run check` を実行しているか」のような
 * コマンド内容の一致では**行わない**。実際に組まれた ci.yml
 * (dependency-gate → checks(matrix) → ci-required)を確認したところ、
 * どのジョブも文字列として "mise run check" を実行してはおらず
 * (checks は個々のサブタスクを `mise run "${{ matrix.task }}"` で実行し、
 * ci-required はジョブ結果を判定するだけ)、コマンド内容によるゲート識別は
 * この実装と整合しない。
 *
 * 代わりに構造だけで定義する: 2 個以上のジョブを持つ workflow ファイルでは、
 * `needs` を持たないジョブ(グラフの根)がちょうど 1 個であるべきで、それが
 * ゲートである。根が 1 個であれば、GitHub Actions の `needs` は同一ファイル
 * 内の実在するジョブ ID しか参照できないため、あらゆるジョブの依存チェーンは
 * 遡ると必ずその根に辿り着く(そうならない場合は `needs` が存在しないジョブ
 * ID を指している壊れた参照であり、これも違反として検出する)。
 *
 * `needs` は GitHub Actions の仕様上、同一 workflow ファイル内のジョブしか
 * 指定できない(workflow をまたいだ依存は `needs` では表現できない)。
 * そのため検証は workflow ファイルごとに閉じたスコープで行う。
 *
 * ② matrix ⇔ depends 同期: `.github/workflows/ci.yml` の `checks` ジョブが
 * 持つ `strategy.matrix.task` の一覧と、`mise.toml` の `[tasks.check]` が
 * 持つ `depends` の一覧が、集合として完全一致していることを検証する。
 * `mise.toml` が正本(matrix はそれをそのまま列挙するだけ、原則8)である
 * ため、②は「正本と転記先がずれていないか」を機械で縛る。過去に
 * `docs:check` が matrix にだけ存在し `depends` には無い(CI が必ず落ちる)
 * 不整合が実際に発生しており、再発防止のために追加した。
 *
 * `check` の依存から意図的に外したタスク(`docs:check` / `test:e2e` /
 * `check:vulnerabilities` / `check:codeql` / `check:source-sync` 等)を
 * 例外として許可リスト化することはしない。「`depends` に無いものは
 * matrix にも無い」がこの検証で守りたい不変条件そのものであり、例外を
 * 作ると検証が空洞化する。なお ci-required や source-sync・
 * check-vulnerabilities のような、`checks`(matrix)ジョブ以外の CI ジョブは
 * この検証の対象外(検証対象は matrix のタスク一覧のみ)。
 */
import { type WorkflowJob, extractJobs } from "../workflow-parsing/github-actions-workflow.ts";

interface WorkflowFile {
  readonly path: string;
  readonly jobs: readonly WorkflowJob[];
}

interface GateViolation {
  readonly file: string;
  readonly message: string;
}

function parseWorkflowFile(path: string, yamlText: string): WorkflowFile {
  return { path, jobs: extractJobs(yamlText) };
}

interface TransitiveDependencyQuery {
  readonly jobs: readonly WorkflowJob[];
  readonly fromId: string;
  readonly targetId: string;
}

function dependsOnTransitively(
  query: TransitiveDependencyQuery,
  seen: Set<string> = new Set<string>(),
): boolean {
  const { jobs, fromId, targetId } = query;
  if (fromId === targetId) {
    return true;
  }
  if (seen.has(fromId)) {
    return false;
  }
  seen.add(fromId);
  const job = jobs.find((candidate) => candidate.id === fromId);
  if (!job) {
    return false;
  }
  return job.needs.some((dependencyId) =>
    dependsOnTransitively({ jobs, fromId: dependencyId, targetId }, seen),
  );
}

/** needs を持たないルートジョブが 1 個でない場合の違反を組み立てる。 */
function buildMultipleRootsViolation(
  file: WorkflowFile,
  roots: readonly WorkflowJob[],
): GateViolation {
  const rootList = roots.map((job) => job.id).join(", ") || "(なし)";
  return {
    file: file.path,
    message: `ジョブが ${file.jobs.length} 個あるのに、needs を持たないルートジョブが ${roots.length} 個ある(ちょうど 1 個であるべき。複数あると一部のジョブがゲートを迂回できる): ${rootList}`,
  };
}

/** ゲート以外の各ジョブについて、ゲートへの(直接・間接の) needs 依存が無いものを違反として集める。 */
function buildUnreachableJobViolations(file: WorkflowFile, gate: WorkflowJob): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const job of file.jobs) {
    if (job.id === gate.id) {
      continue;
    }
    if (!dependsOnTransitively({ jobs: file.jobs, fromId: job.id, targetId: gate.id })) {
      violations.push({
        file: file.path,
        message: `job "${job.id}" は gate job "${gate.id}" に needs で(直接・間接に)依存していない(ゲートを迂回できる状態、または needs が存在しないジョブ ID を指している)`,
      });
    }
  }
  return violations;
}

/**
 * 単一 workflow ファイルを検証する。ジョブが 1 個以下のファイルは
 * (迂回できる「他のジョブ」が無いため)無条件で違反ゼロにする。
 */
function checkGateStructure(file: WorkflowFile): GateViolation[] {
  const { jobs } = file;
  if (jobs.length <= 1) {
    return [];
  }

  const roots = jobs.filter((job) => job.needs.length === 0);
  if (roots.length !== 1) {
    return [buildMultipleRootsViolation(file, roots)];
  }

  const [gate] = roots;
  if (!gate) {
    return [];
  }

  return buildUnreachableJobViolations(file, gate);
}

/** ファイル内に 2 個以上のジョブを持つものが 1 つも無いと、ゲート構造自体が検証されず空振りする。 */
function hasMultiJobWorkflow(files: readonly WorkflowFile[]): boolean {
  return files.some((file) => file.jobs.length > 1);
}

/** matrix ⇔ depends 同期の違反元を指す固定ラベル(比較対象が単一ファイルではなく2ファイルの組のため)。 */
const MATRIX_DEPENDS_SYNC_SOURCE =
  "mise.toml [tasks.check].depends ⇔ .github/workflows/ci.yml matrix.task";

/**
 * `dependsTasks`(mise.toml の `[tasks.check].depends`)と `matrixTasks`
 * (ci.yml の `checks` ジョブの `strategy.matrix.task`)が集合として完全
 * 一致することを検証する。どちらか一方にしか無いタスクがあれば、
 * どちら向きのズレかが分かる形でそれぞれ報告する(両方向とも起こり得る
 * ため、両方をチェックして両方とも報告する。片方を確認したら早期 return
 * しない)。既存の `GateViolation`(`{ file, message }`)をそのまま使う
 * (似た形の新しい violation 型を増やさない)。
 */
function checkMatrixDependsSync(
  dependsTasks: readonly string[],
  matrixTasks: readonly string[],
): GateViolation[] {
  const matrixSet = new Set(matrixTasks);
  const dependsSet = new Set(dependsTasks);

  const missingInMatrix = [...new Set(dependsTasks)].filter((task) => !matrixSet.has(task));
  const missingInDepends = [...new Set(matrixTasks)].filter((task) => !dependsSet.has(task));

  const violations: GateViolation[] = [];
  if (missingInMatrix.length > 0) {
    violations.push({
      file: MATRIX_DEPENDS_SYNC_SOURCE,
      message: `depends にあるが matrix.task に無い: ${missingInMatrix.join(", ")}`,
    });
  }
  if (missingInDepends.length > 0) {
    violations.push({
      file: MATRIX_DEPENDS_SYNC_SOURCE,
      message: `matrix.task にあるが depends に無い: ${missingInDepends.join(", ")}`,
    });
  }
  return violations;
}

export { parseWorkflowFile, checkGateStructure, hasMultiJobWorkflow, checkMatrixDependsSync };
export type { WorkflowFile, GateViolation };
