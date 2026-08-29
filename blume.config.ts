import { defineConfig } from "blume";

// blume はローカル専用（§6「blume」）。
//
// deployment.site を設定していないのは意図的（spec 表の指示どおり）。
// ai.mcp（MCP サーバー）と ai.ask（Ask AI）はどちらもリクエスト時に動く
// サーバールートで、Ask AI の POST /api/ask は認証を掛けられない設計
// （unauthenticated であることが blume 自身の前提。2026-08-08 に
// https://useblume.dev/docs/configuration/ai の Ask AI > Rate limiting
// で確認）。deployment.site を設定して外部公開すると、そのままコスト濫用の
// 口になる。デプロイしない・CI にも組み込まない運用でのみ安全なため、
// site は設定しないままにする（原則4「抑制には理由を書く」と同じ発想を
// 制約の記録に適用したもの。§6「blume」参照）。
export default defineConfig({
  content: {
    root: "docs",
  },

  // i18n を明示的に宣言する。宣言しないと Orama の既定トークナイザが
  // 空白区切りしか見ないため、日本語の複合語が検索に 1 件もヒットしない
  // （§6「blume」表 / 受入条件6）。宣言すると
  // Intl.Segmenter ベースの分割トークナイザに切り替わる
  // （2026-08-08 に https://useblume.dev/docs/configuration/search の
  // "Languages written without spaces" で確認）。
  i18n: {
    defaultLocale: "ja",
    locales: [{ code: "ja", label: "日本語" }],
  },

  search: {
    provider: "orama",
  },

  ai: {
    llmsTxt: true,
    mcp: {
      enabled: true,
      // 既定値と同じだが、.mcp.json 側がこのパスに直接依存しているため
      // （http://localhost:4321/mcp）、結合点であることが分かるように明示する。
      route: "/mcp",
    },
    ask: {
      enabled: true,
      // provider / model は既定（"gateway" / "openai/gpt-5.5"）のまま。
      // 既定 provider は AI_GATEWAY_API_KEY を読む
      // （.env.example に op:// 参照を用意済み。原則9「Secrets」）。
      // モデル選定は blume 側の既定に委ね、本テンプレートでは指定しない
      // （design doc に具体的なモデル名の指定は無いため、推測で埋めない）。
    },
  },

  deployment: {
    // ai.mcp.enabled / ai.ask.enabled はどちらもリクエスト時に動く
    // サーバールートを要求し、static ビルドでは fail-fast する
    // （2026-08-08 に blume 公式ドキュメントで確認）。
    output: "server",
    adapter: "node",
  },
});
