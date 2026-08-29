// サードパーティ SDK の import は合成ルート（application/composition.ts）に閉じる必要がある。
import { createPaymentClient } from "@fixtures/payment-sdk";

export const paymentClient = createPaymentClient();
