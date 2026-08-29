/**
 * 送り先は空スロット（design §5「送り先は空スロット」）。実プロジェクトが
 * 標準出力やログ収集基盤を選んだら、この 1 ファイルだけを差し替える。
 *
 * 標準出力（console / process.stdout）を実装として選ばないのは、
 * `eslint/no-console`（apps/api では "error"）と、apps/api が node: 組み込み
 * モジュールの型（@types/node）をまだ catalog 参照していないこと（§9「最小の
 * 縦切り」の register-task.use-case.ts が node:crypto を避けた判断と同じ制約）
 * の両方に抵触するため。縦切りではメモリに留める。
 */
interface Sink {
  readonly write: (line: string) => void;
}

interface InMemorySink extends Sink {
  readonly lines: readonly string[];
}

function createInMemorySink(): InMemorySink {
  const lines: string[] = [];
  return {
    write: (line: string): void => {
      lines.push(line);
    },
    lines,
  };
}

export { createInMemorySink };
export type { InMemorySink, Sink };
