import type { GreetingApi, GreetingApiFailureCode } from "../../lib/api/greeting-api.js";
import { GreetingApiError } from "../../lib/api/greeting-api.js";
import { renderGreetingMessage } from "../../components/greeting-message/greeting-message.js";

export interface LoadGreetingViewInput {
  readonly api: GreetingApi;
  readonly name: string;
}

/**
 * GreetingApiFailureCode（閉じた語彙）を網羅する。新しいコードが増えると
 * この switch が exhaustive でなくなり型検査で落ちる（TypeScript の
 * never 網羅チェック。原則12「閉じた語彙で合成可能」のフロント側の最小実演）。
 */
function renderGreetingFailureMessage(code: GreetingApiFailureCode): string {
  switch (code) {
    case "invalid-name": {
      return "名前を入力してください";
    }
    default: {
      const exhaustiveCheck: never = code;
      throw new Error(`未知の GreetingApiFailureCode: ${String(exhaustiveCheck)}`);
    }
  }
}

/**
 * API 境界（lib/api）を経由するため feature に区分する（§3「フロントエンド」の
 * 判定基準:「テストに API モックが要るなら feature」）。
 *
 * GreetingApiError は明示的にユーザー向けメッセージへ変換する（silent
 * fallback ではない。原則2 fail-fast の但し書き:「失敗への対処を UI 層で
 * 明示すること」自体は禁止されていない）。それ以外の例外は rethrow する。
 */
export async function loadGreetingView(input: Readonly<LoadGreetingViewInput>): Promise<string> {
  try {
    const { message } = await input.api.fetchGreeting(input.name);
    return renderGreetingMessage({ message });
  } catch (error) {
    if (error instanceof GreetingApiError) {
      return renderGreetingMessage({ message: renderGreetingFailureMessage(error.code) });
    }
    throw error;
  }
}
