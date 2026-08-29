/**
 * package.json から依存 4 種（dependencies / devDependencies /
 * peerDependencies / optionalDependencies）の specifier を取り出す。
 * package.json は正規の JSON なので `JSON.parse` で足りる
 * （YAML 用の独自パーサは要らない）。
 *
 * 形の確定は境界（`parsePackageManifest`）で 1 回だけ行い、以降の関数は
 * 確定した `PackageManifest` だけを受け取る。以前は `unknown` を各所へ回して
 * `typeof` で都度絞り込んでいたが、それだと「値が string でなければ黙って
 * 読み飛ばす」経路が関数ごとに増え、pin されていない依存を静かに見逃す形に
 * なりうる（原則2 fail-fast）。トップレベルがオブジェクトでなければここで
 * 落とす。
 */

/** 依存フィールド 1 つ分の中身。package.json の契約上、値は必ず specifier 文字列。 */
type DependencyTable = Readonly<Record<string, string>>;

/** package.json のうち、このモジュールが読む範囲だけの契約。 */
interface PackageManifest {
  readonly dependencies?: DependencyTable;
  readonly devDependencies?: DependencyTable;
  readonly peerDependencies?: DependencyTable;
  readonly optionalDependencies?: DependencyTable;
}

type DependencyField = keyof PackageManifest;

interface ManifestSpecifier {
  readonly field: DependencyField;
  readonly name: string;
  readonly specifier: string;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const satisfies readonly DependencyField[];

/**
 * package.json のテキストを `PackageManifest` に確定させる I/O 境界。
 *
 * スキーマライブラリ（zod）は使えない: tests/policy は pnpm workspace の
 * パッケージではなく（pnpm-workspace.yaml 参照）、依存を宣言する package.json
 * を持たない。mise-tasks.ts が汎用 TOML パーサを諦めたのと同じ制約。
 */
function parsePackageManifest(packageJsonText: string): PackageManifest {
  const parsed: unknown = JSON.parse(packageJsonText);
  if (!(parsed instanceof Object) || Array.isArray(parsed)) {
    throw new Error("package.json のトップレベルはオブジェクトである必要があります。");
  }
  // 上の絞り込みで `parsed` は `Object` になっており、全フィールドが任意の
  // `PackageManifest` へそのまま代入できる（型アサーションは要らない）。
  // 各依存フィールドが name → specifier 文字列の table であることは npm / pnpm
  // 側が保証する package.json の契約で、破れていれば下流の specifier 検査が
  // その値をそのまま報告して落ちる（黙って読み飛ばす経路を作らない）。
  return parsed;
}

/** 1 つの依存フィールド(dependencies 等)の specifier を、フィールド名付きで並べる。 */
function collectFieldSpecifiers(
  field: DependencyField,
  table: DependencyTable,
): ManifestSpecifier[] {
  return Object.entries(table).map(([name, specifier]) => ({ field, name, specifier }));
}

function extractManifestSpecifiers(packageJsonText: string): ManifestSpecifier[] {
  const manifest = parsePackageManifest(packageJsonText);
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const table = manifest[field];
    return table === undefined ? [] : collectFieldSpecifiers(field, table);
  });
}

export { extractManifestSpecifiers };
export type { ManifestSpecifier };
