// 公開面は re-export のみにする（index-re-export-only / architecture checker）。
//
// `LoadGraphViewInput` は公開面から re-export しない。呼び出し側は object
// literal をそのまま渡せば構造的型付けで足りるため、名前で import する
// 外部の呼び出し元が無い（apps/web/src/features/greeting/index.ts と同じ判断）。
export { loadGraphView } from "./graph-view.ts";
