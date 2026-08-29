import {
  type FeatureDescriibeCallbackParams,
  describeFeature,
  loadFeature,
} from "@amiceli/vitest-cucumber";

import type { GreetingApi } from "../../lib/api/greeting-api.js";
import { GreetingApiError } from "../../lib/api/greeting-api.js";
import { expect } from "vitest";
import { loadGreetingView } from "./index.js";

const feature = await loadFeature("./greeting.feature");

type ScenarioTest = FeatureDescriibeCallbackParams["Scenario"];

/**
 * シナリオごとに関数へ分割する（max-lines-per-function 対応。register-task.spec.ts と同じ形）。
 *
 * Given/When/Then の骨格が他の BDD シナリオ関数（例: register-task.spec.ts の
 * registerEmptyTitleScenario）と似た形になり similarity-ts が検出するが、
 * 検証している業務の振る舞いは別で将来別々に変わる（design §5「similarity-ts
 * （重複検出）」の 2 番目の対応「重複を残し、理由つきで抑制する」）。
 */
// similarity-ignore
const greetsByNameScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "名前を渡すと挨拶メッセージのビューが生成される",
    ({ Given: given, When: when, Then: then }) => {
      let api: GreetingApi;
      let name: string;
      let view: string;

      given("名前が「はやかわ」の挨拶 API がある", () => {
        name = "はやかわ";
        api = {
          fetchGreeting: async (requestedName): Promise<{ message: string }> => ({
            message: `こんにちは、${requestedName} さん`,
          }),
        };
      });

      when("挨拶ビューを読み込む", async () => {
        view = await loadGreetingView({ api, name });
      });

      then("挨拶メッセージには「こんにちは、はやかわ さん」が含まれる", () => {
        expect(view).toContain("こんにちは、はやかわ さん");
      });
    },
  );
};

// similarity-ignore（理由は greetsByNameScenario 参照。骨格は似ているが別の業務シナリオ）
const invalidNameScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "空の名前は invalid-name という閉じた語彙のコードとして扱われる",
    ({ Given: given, When: when, Then: then }) => {
      let api: GreetingApi;
      let name: string;
      let view: string;

      given("名前が空の挨拶 API がある", () => {
        name = "";
        api = {
          fetchGreeting: async (): Promise<{ message: string }> => {
            throw new GreetingApiError("invalid-name");
          },
        };
      });

      when("挨拶ビューを読み込む", async () => {
        view = await loadGreetingView({ api, name });
      });

      then("挨拶メッセージには「名前を入力してください」が含まれる", () => {
        expect(view).toContain("名前を入力してください");
      });
    },
  );
};

// 公開エントリポイント（index.js）だけを import する（原則6「公開契約のみテストする」）。
describeFeature(feature, ({ Scenario }) => {
  greetsByNameScenario(Scenario);
  invalidNameScenario(Scenario);
});
