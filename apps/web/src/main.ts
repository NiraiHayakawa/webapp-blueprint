// ブラウザの実行エントリポイント。
// これは配線の実証であり、消して始めてよい（docs/plan/Template/20260807_template-design.md §9）。

import { routes } from "./routes/index.js";

const container = document.querySelector("#app");
if (container === null) {
  throw new Error("#app 要素が見つからない");
}

const route = routes.find((candidate) => candidate.path === globalThis.location.pathname);
if (route === undefined) {
  throw new Error(`未定義のルート: ${globalThis.location.pathname}`);
}

container.innerHTML = await route.render();
