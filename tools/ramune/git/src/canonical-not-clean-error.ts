// cleanup 証跡（canonicalAfterCleanup）は canonical が clean のときしか生成できない
// （設計正本 §6.2 / §6.3）。未遂の cleanup を証跡だけで誤魔化させないための拒否。
export class CanonicalNotCleanError extends Error {
  readonly observedState: Exclude<"clean" | "dirty" | "merge_in_progress" | "missing", "clean">;

  constructor(
    observedState: Exclude<"clean" | "dirty" | "merge_in_progress" | "missing", "clean">,
  ) {
    super(
      `canonical worktree が clean ではありません（${observedState}）。` +
        "cleanup 後の証跡（canonicalAfterCleanup）は clean 状態でしか生成できません。",
    );
    this.name = "CanonicalNotCleanError";
    this.observedState = observedState;
  }
}
