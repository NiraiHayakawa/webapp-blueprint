#!/usr/bin/env bash
# PR 自動レビュー（Claude / Codex 共通）のオーケストレーション用ヘルパー。
#
# 正本: docs/plan/Template/20260807_template-design.md §7「PR 自動レビュー」。
# レビューの「内容」は各 workflow（LLM への prompt）が担い、このスクリプトは
# 「いつ走らせるか・どこに書くか」という決定的な手続きだけを担う
# （原則8: 検査ロジックの二重管理を避けるため、判定ロジックは 1 箇所に集約する）。
#
# 前提: gh CLI が呼び出し元 workflow で認証済み（GH_TOKEN が環境変数にある）。
#
# 注意（このスクリプト固有の実装選択。spec 本文が数値まで定めているわけではない）:
# - sensitive path の正規表現、full mode への切り替え閾値（変更行数・新規ファイル数）は
#   このテンプレートの初期値。運用しながら docs/recipes/ 側で妥当性を検証し直すことを想定する。
# - review thread の「自分（このワークフロー）が作ったスレッドか」の判定は、
#   各 inline comment 本文の末尾に埋め込む hidden marker 文字列に依存する。
#   Claude 側は prompt 経由でこの規約を守らせているため、LLM の指示追従が前提になる
#   （Codex 側は github-script からコメント本文を組み立てているため確実）。

set -euo pipefail

# --- 設定（環境変数で上書き可能） -------------------------------------------

PR_REVIEW_SENSITIVE_PATH_REGEX="${PR_REVIEW_SENSITIVE_PATH_REGEX:-(^|/)auth(/|$)|(^|/)migrations(/|$)|^infra/|^\.github/workflows/}"
PR_REVIEW_FULL_MODE_LINES_THRESHOLD="${PR_REVIEW_FULL_MODE_LINES_THRESHOLD:-500}"
PR_REVIEW_FULL_MODE_NEWFILES_THRESHOLD="${PR_REVIEW_FULL_MODE_NEWFILES_THRESHOLD:-10}"

# --- diff の SHA256（同一 diff への重複レビューを抑止） -----------------------
# ファイル名 + patch 本文を連結してハッシュ化する。連結順は compare API が返す
# 順（パス名の辞書順ではない場合がある）なので、同じ base/head なら同じ順で
# 安定して同じハッシュになることのみを保証する（別 base/head 間の比較はしない）。
pr_review_diff_hash() {
  local owner_repo="$1" base_sha="$2" head_sha="$3"
  gh api "repos/${owner_repo}/compare/${base_sha}...${head_sha}" \
    --jq '[.files[]? | (.filename + " " + (.patch // ""))] | join("")' \
    | sha256sum | awk '{print $1}'
}

# --- delta / full モードの判定 ------------------------------------------------
# 標準出力に "delta" または "full" を 1 行で返す。判定理由は標準エラーに出す。
#
# 注意: GitHub の compare API は files を最大 300 件までしか返さない
# （それを超える場合は "List pull request files" エンドポイントでの再取得が
#   必要になる）。このテンプレートの縦切りが想定する PR 規模では十分だが、
# 実運用で 300 ファイルを超える PR が出るなら別エンドポイントへの切り替えが
# 必要（報告に明記する既知の制約。この関数と pr_review_diff_hash の両方に
# 同じ制約がある）。
pr_review_decide_mode() {
  local owner_repo="$1" base_sha="$2" head_sha="$3"
  local compare_json
  compare_json="$(gh api "repos/${owner_repo}/compare/${base_sha}...${head_sha}")"

  local sensitive_hit
  sensitive_hit="$(jq -r '.files[]?.filename' <<<"$compare_json" \
    | grep -E "$PR_REVIEW_SENSITIVE_PATH_REGEX" || true)"

  if [ -n "$sensitive_hit" ]; then
    echo "sensitive path 検出のため full mode を強制: $(tr '\n' ',' <<<"$sensitive_hit")" >&2
    echo "full"
    return 0
  fi

  local total_lines new_files
  total_lines="$(jq '[.files[]? | (.additions + .deletions)] | add // 0' <<<"$compare_json")"
  new_files="$(jq '[.files[]? | select(.status == "added")] | length' <<<"$compare_json")"

  if [ "$total_lines" -gt "$PR_REVIEW_FULL_MODE_LINES_THRESHOLD" ]; then
    echo "変更行数 ${total_lines} が閾値 ${PR_REVIEW_FULL_MODE_LINES_THRESHOLD} を超えたため full mode" >&2
    echo "full"
    return 0
  fi
  if [ "$new_files" -gt "$PR_REVIEW_FULL_MODE_NEWFILES_THRESHOLD" ]; then
    echo "新規ファイル数 ${new_files} が閾値 ${PR_REVIEW_FULL_MODE_NEWFILES_THRESHOLD} を超えたため full mode" >&2
    echo "full"
    return 0
  fi

  echo "delta mode（sensitive path なし・変更行数 ${total_lines}・新規ファイル ${new_files}）" >&2
  echo "delta"
}

# --- suggestion 適用だけのコミットかどうかの判定 -------------------------------
# GitHub の「提案を適用（バッチ）」機能が commit する際の既定コミットメッセージ
# ("Apply suggestions from code review") にすべてのコミットが一致する場合にのみ
# 「suggestion 適用のみ」と判定する。単発の「Update <file>」コミット（1 行だけの
# 提案をその場で commit した場合の既定メッセージ）は通常の手編集コミットと
# メッセージだけでは区別できないため対象にしない（見逃す方向に倒す =
#   誤ってレビューをスキップするより、余分にレビューが走る方が安全という判断。
#   これはこのテンプレート固有のヒューリスティックであり、spec 本文はコミット
#   メッセージの具体的な判定方法までは定めていない）。
pr_review_is_suggestion_only_push() {
  local owner_repo="$1" before_sha="$2" after_sha="$3"

  if [ -z "$before_sha" ] || [ "$before_sha" = "0000000000000000000000000000000000000000" ]; then
    echo "false"
    return 0
  fi

  local commits_json
  commits_json="$(gh api "repos/${owner_repo}/compare/${before_sha}...${after_sha}" --jq '.commits')"

  local commit_count
  commit_count="$(jq 'length' <<<"$commits_json")"
  if [ "$commit_count" -eq 0 ]; then
    echo "false"
    return 0
  fi

  local non_matching
  non_matching="$(jq '[.[] | select((.commit.message | test("^Apply suggestions? from code review")) | not)] | length' <<<"$commits_json")"

  if [ "$non_matching" -eq 0 ]; then
    echo "true"
  else
    echo "false"
  fi
}

# --- 前回の要約コメントに埋め込まれた diff-sha256 の取り出し -------------------
# 見つからない場合(初回実行・過去コメントに埋め込みが無い)は空文字を返す。
# jq の capture が失敗する経路を try/catch で吸収しているのは grep の
# 「一致0件で終了コード1」問題を避けるためであり、gh api 自体の失敗
# (認証エラー等)は catch していない。gh api が失敗すれば
# set -euo pipefail によりこの関数はそのまま失敗する(fail-fast。原則2)。
pr_review_previous_diff_hash() {
  local owner_repo="$1" pr_number="$2" marker="$3"
  gh api "repos/${owner_repo}/issues/${pr_number}/comments" --paginate \
    --jq "[.[] | select(.body | contains(\"${marker}\"))] | last | (.body // \"\") | (try (capture(\"diff-sha256:(?<h>[0-9a-f]{64})\").h) catch \"\")"
}

# --- marker 付きコメントの検索 / upsert ---------------------------------------
pr_review_find_marker_comment_id() {
  local owner_repo="$1" pr_number="$2" marker="$3"
  gh api "repos/${owner_repo}/issues/${pr_number}/comments" --paginate \
    --jq "[.[] | select(.body | contains(\"${marker}\"))] | last | .id // empty"
}

# body_file の内容で、既存の marker 付きコメントを更新する（無ければ新規作成）。
# これにより同じ内容のコメントが PR に溜まらない（spec §7「marker upsert」）。
pr_review_upsert_comment() {
  local owner_repo="$1" pr_number="$2" marker="$3" body_file="$4"
  local existing_id
  existing_id="$(pr_review_find_marker_comment_id "$owner_repo" "$pr_number" "$marker")"
  if [ -n "$existing_id" ]; then
    gh api --method PATCH "repos/${owner_repo}/issues/comments/${existing_id}" \
      -f body=@"${body_file}" >/dev/null
  else
    gh api --method POST "repos/${owner_repo}/issues/${pr_number}/comments" \
      -f body=@"${body_file}" >/dev/null
  fi
}

# --- 前回の未解決 bot レビュースレッドを一括 resolve --------------------------
# bot_marker を本文に含む未解決スレッドだけを対象にする（人間レビュアーの
# スレッドは対象外）。GraphQL の reviewThreads は最初の 100 件のみを見る
# （このテンプレートの縦切りが想定する PR 規模では十分と判断した簡略化。
#   実運用でスレッド数が 100 を超える場合はページングの追加が必要）。
pr_review_resolve_stale_threads() {
  local owner="$1" repo="$2" pr_number="$3" bot_marker="$4"

  local threads_json
  # shellcheck disable=SC2016 # $owner/$repo/$number は GraphQL 変数であり
  # bash 変数ではない。意図的に単一引用符で展開させていない。
  threads_json="$(gh api graphql -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { body }
              }
            }
          }
        }
      }
    }' -f owner="$owner" -f repo="$repo" -F number="$pr_number")"

  local ids
  ids="$(jq -r --arg m "$bot_marker" '
    .data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved == false)
    | select((.comments.nodes[0].body // "") | contains($m))
    | .id' <<<"$threads_json")"

  if [ -z "$ids" ]; then
    return 0
  fi

  while IFS= read -r thread_id; do
    [ -n "$thread_id" ] || continue
    # shellcheck disable=SC2016 # $threadId は GraphQL 変数であり bash 変数
    # ではない。意図的に単一引用符で展開させていない。
    gh api graphql -f query='
      mutation($threadId: ID!) {
        resolveReviewThread(input: { threadId: $threadId }) {
          thread { id }
        }
      }' -f threadId="$thread_id" >/dev/null
  done <<<"$ids"
}
