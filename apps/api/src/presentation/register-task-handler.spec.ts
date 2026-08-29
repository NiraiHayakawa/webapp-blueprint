import {
  type FeatureDescriibeCallbackParams,
  describeFeature,
  loadFeature,
} from "@amiceli/vitest-cucumber";
import {
  RegisterTaskUseCase,
  type RegisterTaskInput,
  type RegisterTaskOutput,
} from "../application/register-task/register-task.use-case.js";
import type { TaskRepository } from "../application/register-task/register-task.port.js";
import { InMemoryTaskRepository } from "../infrastructure/in-memory-task-repository.js";
import { RetryingTaskRepository } from "../infrastructure/retrying-task-repository.js";
import { createInMemorySink, type InMemorySink } from "../logging/sink.js";
import { AppException } from "../logging/app-exception.js";
import { toApiErrorResponse } from "../logging/api-error-response.js";
import { parseLogLine } from "../logging/log-line-fixture.js";
import { classifyRegisterTaskFailure } from "./register-task-failure-classification.js";
import { createRegisterTaskHandler } from "./register-task-handler.js";
import { expect } from "vitest";

const feature = await loadFeature("./register-task-handler.feature");

type ScenarioTest = FeatureDescriibeCallbackParams["Scenario"];

const OPERATION = "task.register";
const MAX_ATTEMPTS = 2;

/** 常に失敗する TaskRepository（境界の後ろに置くテスト用の fake）。 */
class AlwaysFailingTaskRepository implements TaskRepository {
  public async save(): Promise<void> {
    await Promise.resolve();
    throw new Error(`${this.constructor.name}: 保存に失敗した（テスト用）`);
  }
}

interface HandlerContext {
  readonly handler: (input: Readonly<RegisterTaskInput>) => Promise<RegisterTaskOutput>;
  readonly sink: InMemorySink;
}

function createHandlerContext(delegate: TaskRepository): HandlerContext {
  const repository = new RetryingTaskRepository({ delegate, maxAttempts: MAX_ATTEMPTS });
  const useCase = new RegisterTaskUseCase(repository);
  const sink = createInMemorySink();
  const handler = createRegisterTaskHandler(useCase, {
    operation: OPERATION,
    sink,
    classifyFailure: classifyRegisterTaskFailure,
  });
  return { handler, sink };
}

/**
 * `caughtError` は Gherkin の各 step 間で共有される `unknown` 変数で、
 * TypeScript は step をまたいだ instanceof の絞り込みを追跡できない。
 * `as AppException` で直接キャストせず、この関数の中で instanceof を
 * 確認してから返すことで安全な絞り込みにする（no-unsafe-type-assertion 対応）。
 * 引数名 `cause` の理由は observe.ts の ObserveResultParams を参照。
 */
function asAppException(cause: unknown): AppException {
  if (!(cause instanceof AppException)) {
    throw new Error("AppException を期待したが、違う型が渡された（テストの前提が崩れている）");
  }
  return cause;
}

/**
 * シナリオごとに関数へ分割する（max-lines-per-function 対応。register-task.spec.ts と同じ形）。
 */
const successScenario = (Scenario: ScenarioTest): void => {
  Scenario("成功時は1本の成功ログを残す", ({ Given: given, When: when, Then: then, And: and }) => {
    let context: HandlerContext;
    let output: RegisterTaskOutput;

    given("タスク登録ハンドラがある", () => {
      context = createHandlerContext(new InMemoryTaskRepository());
    });

    when("タイトルが「買い物リストを作る」で呼び出す", async () => {
      output = await context.handler({ title: "買い物リストを作る" });
    });

    then("記録されたログは1本だけである", () => {
      expect(output).toBeDefined();
      expect(context.sink.lines).toHaveLength(1);
    });

    and("ログのレベルは「info」である", () => {
      const logLine = parseLogLine(context.sink.lines[0] ?? "");
      expect(logLine.level).toBe("info");
    });
  });
};

const invalidInputScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "空タイトルは invalid-input 単独の理由で失敗し、client応答にサーバ専用情報が出ない",
    ({ Given: given, When: when, Then: then, And: and }) => {
      let context: HandlerContext;
      let caughtError: unknown;

      given("タスク登録ハンドラがある", () => {
        context = createHandlerContext(new InMemoryTaskRepository());
        caughtError = undefined;
      });

      when("タイトルが空文字で呼び出す", async () => {
        try {
          await context.handler({ title: "" });
        } catch (error) {
          caughtError = error;
        }
      });

      then("タスクの登録は失敗する", () => {
        expect(caughtError).toBeInstanceOf(AppException);
      });

      and("失敗の理由コードには「invalid-input」だけが含まれる", () => {
        expect([...asAppException(caughtError).reasons]).toStrictEqual(["invalid-input"]);
      });

      and("記録されたログは1本だけである", () => {
        expect(context.sink.lines).toHaveLength(1);
      });

      and("client向けのエラー応答に logDetails は含まれない", () => {
        const response = toApiErrorResponse(asAppException(caughtError));
        expect(response).not.toHaveProperty("logDetails");
      });
    },
  );
};

// similarity-ignore
const storageFailureScenario = (Scenario: ScenarioTest): void => {
  Scenario(
    "ストレージが継続的に失敗すると、storage-unavailable と retry-exhausted が両方立つ",
    ({ Given: given, When: when, Then: then, And: and }) => {
      let context: HandlerContext;
      let caughtError: unknown;

      given("リポジトリへの保存が常に失敗するタスク登録ハンドラがある", () => {
        context = createHandlerContext(new AlwaysFailingTaskRepository());
        caughtError = undefined;
      });

      when("タイトルが「買い物リストを作る」で呼び出す", async () => {
        try {
          await context.handler({ title: "買い物リストを作る" });
        } catch (error) {
          caughtError = error;
        }
      });

      then("タスクの登録は失敗する", () => {
        expect(caughtError).toBeInstanceOf(AppException);
      });

      and(
        "失敗の理由コードには「storage-unavailable」と「retry-exhausted」の両方が含まれる",
        () => {
          const reasons = [...asAppException(caughtError).reasons];
          expect(reasons.toSorted()).toStrictEqual(
            ["retry-exhausted", "storage-unavailable"].toSorted(),
          );
        },
      );

      and("記録されたログは1本だけである", () => {
        expect(context.sink.lines).toHaveLength(1);
      });

      and("client向けのエラー応答に logDetails は含まれない", () => {
        const response = toApiErrorResponse(asAppException(caughtError));
        expect(response).not.toHaveProperty("logDetails");
      });
    },
  );
};

describeFeature(feature, ({ Scenario }) => {
  successScenario(Scenario);
  invalidInputScenario(Scenario);
  storageFailureScenario(Scenario);
});
