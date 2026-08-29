# 0006. `Bash` は ramune の強制対象から外す

- 状態: 採用
- 決定日: 2026-08-12

## 文脈

[ADR 0001](0001-ramune-architecture.md) は `Bash` / `Edit` / `Write` を Worker 専用とし、PreToolUse hook が Orchestrator と Planner からの呼び出しを拒否していた。

[ADR 0005](0005-ramune-restricts-mutation-not-observation.md) の文脈で、hook が worktree の全ツールを拒否する状態を作り込んだ。このとき**復帰に必要な操作（壊れたグラフファイルを消す）が `Bash` であり、それが拒否されていたため自力で復帰できなかった**。`Edit` / `Write` も同じく拒否されるため、ファイルを直す経路も無い。人手で 1 コマンド実行してもらうしか出口が無い状態だった。

## 決定

**`Bash` を PreToolUse hook の matcher から外す。** `.claude/settings.json` の matcher に `Bash` を含めず、`policy.ts` の権限表からも外す。hook は `Bash` の呼び出しを見ないので、**構造的に拒否しえない**。モードが判定不能な状態でも `Bash` は通る。

`Edit` / `Write` は Worker 専用のまま機械強制する。

## 理由と捨てた代替案

この決定は**権限分離を意図的に弱める**ものであり、その代償を明示しておく。

`Bash` からはファイルを書ける（`sed -i`、リダイレクト、`git checkout` 等）。したがって「変更できるのは Worker だけ」という不変条件は、**機械強制としては `Edit` / `Write` の経路にしか残らない**。Orchestrator や Planner が shell 経由でファイルを書くことは、hook では止められなくなった。その規範は各ロールのプロンプトに書かれた指示として残るだけである。

それでもこの形を採る理由は、fail-closed な機構が自分自身の復帰経路を塞ぐと、外部の人手なしには回復できないという点にある。hook は「稼働中かどうか判定できないなら拒否する」という設計（[ADR 0003](0003-ramune-mode-session-field.md)）を持ち、これは正しいが、**判定に使うファイルが壊れているときに、そのファイルを直す手段まで拒否する**。緊急手段を 1 つだけ機構の外に置くのは、fail-closed の原則と復帰可能性の折り合いとして妥当だと判断した。

- **代替案 A: matcher に `Bash` を残し、policy で全ロールに許可する.** 採らない。モード判定不能のときの拒否は role/policy 判定より前で起きるため、そこでも `Bash` を通すには例外の分岐を足すことになる。ツールを matcher から外せば、通すべき経路を「正しく実装し続ける」必要が無くなる（[原則4](../principles/enforce-with-machines.md) の裏返しとして、強制しないと決めたものは機構に持ち込まない）
- **代替案 B: 復帰専用の MCP ツール（例: グラフを破棄する `ramune_reset`）を Orchestrator に与える.** 採らない。復帰が必要になる状況は「グラフが壊れた」だけではない（依存が壊れた、生成物が壊れた、プロセスが残っている等）。想定した 1 つの故障だけに出口を作ると、想定外の故障で同じ袋小路に入る
- **代替案 C: そのまま人手で復帰する運用を続ける.** 採らない。1 コマンドで済む場合もあるが、これは「ramune が動いている間、エージェントは自分の詰まりを解けない」という運用上の制約であり、長い goal を任せる方向とは逆を向く
- **プロンプトに緊急手段として書かない理由.** 常用されると役割分担が形骸化する。プロンプトには「実装と結果の記録は Worker が行う」という規範だけを書き、この決定はこの ADR と `policy.ts` のコメント（開発者が読む場所）に置く

## 影響

- `.claude/settings.json`: PreToolUse matcher から `Bash` を外す
- `tools/ramune/hooks/src/policy.ts`: 権限表から `Bash` を外し、対象外である旨をコメントに残す。`Edit` / `Write` は Worker 専用のまま
- `tools/ramune/hooks/test/`: ロール強制の検証は `Edit` を例に行う（`Bash` はもう policy の対象ではない）
- `.claude/agents/planner.md` / `worker.md`: 緊急手段としての `Bash` には触れない。Planner 側は「実装と結果の記録はしない」という規範の記述に留める
- [`docs/recipes/tools/ramune.md`](../recipes/tools/ramune.md): 権限表を更新する
- ADR 0001 の「変更できるのは Worker だけ」は、**規範としては維持、機械強制としては `Edit` / `Write` に限定**という状態になる。この差はレビュー観点として残る
