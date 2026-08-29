// transport / client の生成は lib/transport/ 配下でのみ許可される。
import { createClient } from "@fixtures/transport-sdk";

export const client = createClient();
