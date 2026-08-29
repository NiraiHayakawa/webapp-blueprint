/**
 * 値オブジェクト + 不変条件（docs/plan/Template/20260807_template-design.md §9）。
 * domain 層は外部パッケージを import しない（§3「バックエンド」）。
 */

import { TaskTitleEmptyError } from "./task-title-empty.error.js";
import { TaskTitleTooLongError } from "./task-title-too-long.error.js";

const TASK_TITLE_MAX_LENGTH = 120;

class TaskTitle {
  public static readonly maxLength = TASK_TITLE_MAX_LENGTH;

  public readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  /**
   * 不変条件: 前後の空白を除いた結果が 1〜{@link TaskTitle.maxLength} 文字であること。
   * 満たさない場合は silent fallback せず即座に throw する（原則2「fail-fast」）。
   */
  public static create(rawValue: string): TaskTitle {
    const trimmedValue = rawValue.trim();

    if (trimmedValue.length === 0) {
      throw new TaskTitleEmptyError();
    }

    if (trimmedValue.length > TaskTitle.maxLength) {
      throw new TaskTitleTooLongError(TaskTitle.maxLength);
    }

    return new TaskTitle(trimmedValue);
  }
}

export { TaskTitle };
