import { createGreetingApi } from "../lib/api/greeting-api.js";
import { loadGreetingView } from "../features/greeting/index.js";

export interface Route {
  readonly path: string;
  readonly render: () => Promise<string>;
}

// ルーティングは薄く、feature を並べるだけにする（§3「フロントエンド: 再帰的 features」）。
export const routes: readonly Route[] = [
  {
    path: "/",
    render: async () => await loadGreetingView({ api: createGreetingApi(), name: "ゲスト" }),
  },
];
