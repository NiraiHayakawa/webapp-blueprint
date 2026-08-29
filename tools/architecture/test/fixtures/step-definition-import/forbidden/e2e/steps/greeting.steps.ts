// step 定義から公開エントリポイント（index）以外の内部ファイルへ直接 import している。
import { renderGreeting } from "../../src/features/greeting/greeting.ts";

export function runGreetingStep(name: string): string {
  return renderGreeting(name);
}
