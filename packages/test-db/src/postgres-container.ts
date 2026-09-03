import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface PostgresContainerOptions {
  readonly image?: string;
  readonly database?: string;
  readonly user?: string;
  readonly password?: string;
}

export type ResolvedPostgresContainerConfig = Required<PostgresContainerOptions>;

const DEFAULT_POSTGRES_IMAGE = "postgres:17-alpine";
const DEFAULT_POSTGRES_DATABASE = "test_db";
const DEFAULT_POSTGRES_USER = "test_user";
const DEFAULT_POSTGRES_PASSWORD = "test_password";

export function resolvePostgresContainerConfig(
  options: PostgresContainerOptions = {},
): ResolvedPostgresContainerConfig {
  return {
    image: options.image ?? DEFAULT_POSTGRES_IMAGE,
    database: options.database ?? DEFAULT_POSTGRES_DATABASE,
    user: options.user ?? DEFAULT_POSTGRES_USER,
    password: options.password ?? DEFAULT_POSTGRES_PASSWORD,
  };
}

export class PostgresContainerStartupError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PostgresContainerStartupError";
  }
}

export interface StartedPostgresContainerHandle {
  readonly connectionUri: string;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly stop: () => Promise<void>;
}

export async function startPostgresContainer(
  options: PostgresContainerOptions = {},
): Promise<StartedPostgresContainerHandle> {
  const config = resolvePostgresContainerConfig(options);

  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer(config.image)
      .withDatabase(config.database)
      .withUsername(config.user)
      .withPassword(config.password)
      .start();
  } catch (error: unknown) {
    throw new PostgresContainerStartupError(
      `Failed to start PostgreSQL Testcontainer (${config.image}). Ensure Docker daemon is running.`,
      error,
    );
  }

  return {
    connectionUri: container.getConnectionUri(),
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    stop: async (): Promise<void> => {
      await container.stop();
    },
  };
}
