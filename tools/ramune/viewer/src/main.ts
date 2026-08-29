// ブラウザの実行エントリポイント（合成ルート）。
//
// .ramune/graph.json は ramune の実行中に書き換わり続けるため、初回描画後は
// 一定間隔で再取得・再描画する。取得に失敗しても画面を空白のままにせず、
// エラーを明示的に表示する（原則2 fail-fast: 失敗を隠さない）。

import { type Route, routes } from "./routes/index.ts";

const POLL_INTERVAL_MS = 2000;

function getContainer(): Element {
  const container = document.querySelector("#app");
  if (container === null) {
    throw new Error("#app 要素が見つからない");
  }
  return container;
}

function getRoute(): Route {
  const route = routes.find((candidate) => candidate.path === globalThis.location.pathname);
  if (route === undefined) {
    throw new Error(`未定義のルート: ${globalThis.location.pathname}`);
  }
  return route;
}

async function renderOnce(container: Element, route: Readonly<Route>): Promise<void> {
  try {
    container.innerHTML = await route.render();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // innerHTML ではなく textContent にする: エラーメッセージは
    // .ramune/graph.json の内容に由来し得るため、HTML として解釈させない。
    container.textContent = `グラフの読み込みに失敗しました: ${message}`;
  }
}

const container = getContainer();
const route = getRoute();

await renderOnce(container, route);
globalThis.setInterval(() => {
  void renderOnce(container, route);
}, POLL_INTERVAL_MS);

// ノードの詳細の開閉は URL のフラグメントが唯一の状態（lib/selected-node）。
// ポーリングを待たずに反映させるため、フラグメントの変化でも再描画する。
globalThis.addEventListener("hashchange", () => {
  void renderOnce(container, route);
});
