// どのノードの詳細を開いているかを URL のフラグメント（`#node-<id>`）で持つ。
//
// なぜ DOM 側の状態（`<details open>` / `:target` / イベントハンドラ）にしないか:
// main.ts は .ramune/graph.json の変化を追うため一定間隔で innerHTML を丸ごと
// 差し替える。DOM に持たせた開閉状態は再描画のたびに失われる。CSS の `:target`
// も同じ理由で使えない — target 要素はナビゲーション時に決まり、innerHTML の
// 差し替えで対象要素が document から消えると外れる（2026-08-10 に実測: ハッシュ
// 付き URL を直接開くと、非同期の初回描画より前に target 解決が終わるため
// そもそも一致しない）。
//
// URL は再描画で消えないため、フラグメントを唯一の状態の置き場にして、描画の
// たびにここから読み直す。ノードの result への直リンクが成立する副産物もある。

const NODE_FRAGMENT_PREFIX = "#node-";

/**
 * `location.hash` から、詳細を開くノードの id を取り出す。
 * ノードを指していない（空・別のフラグメント）場合は `undefined`。
 */
function parseSelectedNodeId(hash: string): string | undefined {
  if (!hash.startsWith(NODE_FRAGMENT_PREFIX)) {
    return undefined;
  }
  const id = decodeURIComponent(hash.slice(NODE_FRAGMENT_PREFIX.length));
  return id.length === 0 ? undefined : id;
}

/** ノードの詳細を開くフラグメント。リンクの `href` に使う。 */
function buildNodeFragment(nodeId: string): string {
  return `${NODE_FRAGMENT_PREFIX}${encodeURIComponent(nodeId)}`;
}

export { parseSelectedNodeId, buildNodeFragment };
