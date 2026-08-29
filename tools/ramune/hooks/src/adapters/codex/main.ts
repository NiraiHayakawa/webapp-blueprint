/**
 * Codex CLI PreToolUse hook CLI エントリポイント。
 */
import { formatCodexDeny } from "./formatter.ts";
import { runCodexHook } from "./runner.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf-8"));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function main(): Promise<void> {
  let raw: string;
  try {
    raw = await readStdin();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(
      formatCodexDeny(
        `ramune hooks (codex) は stdin を読み取れませんでした。安全側に倒して拒否します。原因: ${message}`,
      ),
    );
    return;
  }

  const output = runCodexHook(raw, process.cwd());
  if (output.length > 0) {
    process.stdout.write(output);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
