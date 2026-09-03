import { describe, expect, it } from "vitest";
import {
  type PostgresContainerOptions,
  PostgresContainerStartupError,
  resolvePostgresContainerConfig,
} from "./postgres-container.js";

describe(resolvePostgresContainerConfig, () => {
  it("デフォルト値が明確に設定されていること", () => {
    const config = resolvePostgresContainerConfig();
    expect(config.image).toBe("postgres:17-alpine");
    expect(config.database).toBe("test_db");
    expect(config.user).toBe("test_user");
    expect(config.password).toBe("test_password");
  });

  it("カスタムオプションが正しく反映されること", () => {
    const options: PostgresContainerOptions = {
      image: "postgres:16-alpine",
      database: "custom_db",
      user: "custom_user",
      password: "custom_password",
    };
    const config = resolvePostgresContainerConfig(options);
    expect(config.image).toBe("postgres:16-alpine");
    expect(config.database).toBe("custom_db");
    expect(config.user).toBe("custom_user");
    expect(config.password).toBe("custom_password");
  });
});

describe(PostgresContainerStartupError, () => {
  it("原因エラーを保持し、fail-fast なエラーメッセージを生成すること", () => {
    const cause = new Error("Docker daemon is not running");
    const error = new PostgresContainerStartupError("Failed to start PostgreSQL container", cause);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PostgresContainerStartupError");
    expect(error.message).toContain("Failed to start PostgreSQL container");
    expect(error.cause).toBe(cause);
  });
});
