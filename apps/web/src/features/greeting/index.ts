// 公開面は re-export のみにする（§3「workspace パッケージの公開面」/ architecture checker）。
//
// `LoadGreetingViewInput` は公開面から re-export しない。現時点でこの型を
// 名前で import する外部の呼び出し元が無く（呼び出し側は object literal を
// そのまま渡せば構造的型付けで足りる）、re-export すると knip（未使用検出。
// §5「検出系ツールの運用方針」）が「未使用 export」として検出する。
export { loadGreetingView } from "./greeting.js";
