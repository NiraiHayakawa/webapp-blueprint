import {
  type FeatureDescriibeCallbackParams,
  describeFeature,
  loadFeature,
} from "@amiceli/vitest-cucumber";
import { type RegisterTaskOutput, RegisterTaskUseCase } from "./register-task.use-case.js";

import { InMemoryTaskRepository } from "../../infrastructure/in-memory-task-repository.js";
import { expect } from "vitest";

const feature = await loadFeature("./register-task.feature");

type ScenarioTest = FeatureDescriibeCallbackParams["Scenario"];

/**
 * シナリオごとに関数へ分割する（max-lines-per-function 対応）。
 */
const registerValidTitleScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "有効なタイトルでタスクを登録すると保存される",
    ({ Given: given, When: when, Then: then, And: and }) => {
      let repository: InMemoryTaskRepository;
      let useCase: RegisterTaskUseCase;
      let result: RegisterTaskOutput;

      given("タイトルが「買い物リストを作る」のタスク登録要求がある", () => {
        repository = new InMemoryTaskRepository();
        useCase = new RegisterTaskUseCase(repository);
      });

      when("タスク登録ユースケースを実行する", async () => {
        result = await useCase.execute({ title: "買い物リストを作る" });
      });

      then("タスクがリポジトリに保存される", () => {
        expect(repository.findById(result.id)).toBeDefined();
      });

      and("登録されたタスクのタイトルは「買い物リストを作る」である", () => {
        expect(result.title).toBe("買い物リストを作る");
      });
    },
  );
};

const registerEmptyTitleScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "空文字のタイトルでタスクを登録すると失敗する",
    ({ Given: given, When: when, Then: then }) => {
      let repository: InMemoryTaskRepository;
      let useCase: RegisterTaskUseCase;
      let caughtError: unknown;

      given("タイトルが空文字のタスク登録要求がある", () => {
        repository = new InMemoryTaskRepository();
        useCase = new RegisterTaskUseCase(repository);
        caughtError = undefined;
      });

      when("タスク登録ユースケースを実行する", async () => {
        try {
          await useCase.execute({ title: "" });
        } catch (error) {
          caughtError = error;
        }
      });

      then("タスクの登録は失敗する", () => {
        expect(caughtError).toBeInstanceOf(Error);
      });
    },
  );
};

describeFeature(feature, ({ Scenario }) => {
  registerValidTitleScenario(Scenario);
  registerEmptyTitleScenario(Scenario);
});
