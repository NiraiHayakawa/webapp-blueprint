// このパッケージ内の「パスの存在確認」を 1 箇所に集める。各モジュールが
// 同じ async ヘルパを個別に持つと、挙動（symlink 追従、権限エラーの扱い）が
// ずれたときに片方だけ直し忘れる drift の温床になる。
import fs from "node:fs/promises";

/** パスが存在すれば true。アクセスできない（権限等）場合も存在しないものとして扱う。 */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
