interface GreetingApi {
  fetchGreeting: (name: string) => Promise<{ message: string }>;
}

/** API 呼び出しの失敗を表す閉じた語彙。§「apps/web は最小限で」。 */
type GreetingApiFailureCode = "invalid-name";

/**
 * API 呼び出しの失敗を閉じた語彙のコードとして扱う（原則12の受け皿。
 * フロント側はここまでに留め、observability の横断境界までは持たない）。
 */
class GreetingApiError extends Error {
  public readonly code: GreetingApiFailureCode;

  public constructor(code: GreetingApiFailureCode) {
    super(`挨拶 API が失敗した: ${code}`);
    this.name = "GreetingApiError";
    this.code = code;
  }
}

const fetchGreetingFake = async (name: string): Promise<{ message: string }> => {
  if (name.trim().length === 0) {
    throw new GreetingApiError("invalid-name");
  }
  return { message: `こんにちは、${name} さん` };
};

/**
 * API 接点（§9「最小の縦切り」）。ハンドラ1つを返すフェイクを持ち、
 * 契約層（ADR 0001）を選んだらこの関数の中身だけが差し替わる。
 */
function createGreetingApi(): GreetingApi {
  return {
    fetchGreeting: fetchGreetingFake,
  };
}

export type { GreetingApi, GreetingApiFailureCode };
export { createGreetingApi, GreetingApiError };
