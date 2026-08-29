// 禁止パターン: 合成ルート以外から SDK 実装 + exporter を直接 import している。
import { NodeSDK } from "@opentelemetry/sdk-node";

export const sdk = new NodeSDK();
