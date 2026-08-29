// 統合用 worktree が clean でない状態での merge 開始を拒否する型付きエラー
// （設計正本 §6.2。merge の前提条件）。
export class IntegrationWorkspaceNotCleanError extends Error {
  readonly integrationWorktreePath: string;

  constructor(integrationWorktreePath: string) {
    super(
      `統合用 worktree が clean ではありません（${integrationWorktreePath}）。` +
        "未コミットの変更がある状態で merge は開始できません。",
    );
    this.name = "IntegrationWorkspaceNotCleanError";
    this.integrationWorktreePath = integrationWorktreePath;
  }
}
