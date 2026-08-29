import {
  describeFeature,
  loadFeature,
  type FeatureDescriibeCallbackParams,
} from "@amiceli/vitest-cucumber";

import type { GraphSource } from "../../lib/graph-source/graph-source.ts";
import {
  createFakeGraphSource,
  createGraphWithAbortedNode,
  createGraphWithActiveSession,
  createGraphWithBlockedNode,
  createGraphWithInactiveSession,
  createGraphWithPendingNext,
  createGraphWithResult,
  createGraphWithWaitingPendingNode,
  createNotFoundGraphSource,
} from "./test-support/index.ts";
import { expect } from "vitest";
import { loadGraphView } from "./index.ts";

const feature = await loadFeature("./graph-view.feature");

type Scenario = FeatureDescriibeCallbackParams["Scenario"];

// シナリオ単位でトップレベル関数に切り出しているのは
// eslint/max-lines-per-function（1関数あたりの許容行数）に収めるためであり、
// describeFeature 自体は「1 .feature ファイルにつき1回」呼ぶ以外の形を
// vitest-cucumber の API が許さないため、コールバック内部をシナリオ単位で分割する
// （他の *.spec.ts と同じ形。詳細はそちらのコメント参照）。

/*similarity-ignore: Gherkin の step 定義（Given/When/Then）は「シナリオごとにステップを宣言する」
 * という定型構造を持つのが正しい書き方であり、共通化すると対応する .feature ファイルとの対応が
 * 読めなくなるため、この重複検出の指摘を抑制する。*/
function pendingNextNodeIsHighlighted(Scenario: Scenario): void {
  Scenario(
    "依存を満たした pending ノードが次に選ばれるノードとして強調される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given(
        "「start」が done、「n1」が pending で dep に「start」を持つグラフを返す graphSource がある",
        () => {
          graphSource = createFakeGraphSource(createGraphWithPendingNext());
        },
      );

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果に「n1」を次のノードとして強調するマーカーが含まれる", () => {
        expect.hasAssertions();
        expect(view).toContain('data-node-id="n1" data-next-node="true"');
      });
    },
  );
}

/*similarity-ignore: Gherkin の step 定義（Given/When/Then）は「シナリオごとにステップを宣言する」
 * という定型構造を持つのが正しい書き方であり、共通化すると対応する .feature ファイルとの対応が
 * 読めなくなるため、この重複検出の指摘を抑制する。*/
function abortedNodeIsDisplayedAsIs(Scenario: Scenario): void {
  Scenario(
    "aborted ノードを含むグラフはそのまま表示される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given("「start」が done、「n1」が aborted なグラフを返す graphSource がある", () => {
        graphSource = createFakeGraphSource(createGraphWithAbortedNode());
      });

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果に「n1」が aborted として表示される", () => {
        expect.hasAssertions();
        expect(view).toContain('data-node-id="n1"');
        expect(view).toContain("node-aborted");
      });
    },
  );
}

/*similarity-ignore: Gherkin の step 定義（Given/When/Then）は「シナリオごとにステップを宣言する」
 * という定型構造を持つのが正しい書き方であり、共通化すると対応する .feature ファイルとの対応が
 * 読めなくなるため、この重複検出の指摘を抑制する。*/
function blockedNodeIsDisplayedWithReason(Scenario: Scenario): void {
  Scenario("blocked ノードとその理由が表示される", ({ Given: given, When: when, Then: then }) => {
    let graphSource: GraphSource;
    let view: string;

    given(
      "「start」が done、「n1」が blocked で理由「依存が複雑すぎた」を持つグラフを返す graphSource がある",
      () => {
        graphSource = createFakeGraphSource(createGraphWithBlockedNode());
      },
    );

    when("グラフビューを読み込む", async () => {
      view = await loadGraphView({ graphSource, selectedNodeId: undefined });
    });

    then("描画結果に「n1」が blocked としてその理由とともに表示される", () => {
      expect.hasAssertions();
      expect(view).toContain('data-node-id="n1"');
      expect(view).toContain("node-blocked");
      expect(view).toContain("依存が複雑すぎた");
    });
  });
}

/*similarity-ignore: Gherkin の step 定義（Given/When/Then）は「シナリオごとにステップを宣言する」
 * という定型構造を持つのが正しい書き方であり、共通化すると対応する .feature ファイルとの対応が
 * 読めなくなるため、この重複検出の指摘を抑制する。*/
function noGraphStateIsDisplayedWhenGraphDoesNotExist(Scenario: Scenario): void {
  Scenario(
    "グラフがまだ存在しない場合は「まだありません」という状態が表示される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given(".ramune/graph.json がまだ存在しない graphSource がある", () => {
        graphSource = createNotFoundGraphSource();
      });

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果に「グラフがまだありません」という状態が含まれる", () => {
        expect.hasAssertions();
        expect(view).toContain("グラフがまだありません");
      });
    },
  );
}

/*similarity-ignore: Gherkin の step 定義（Given/When/Then）は「シナリオごとにステップを宣言する」
 * という定型構造を持つのが正しい書き方であり、共通化すると対応する .feature ファイルとの対応が
 * 読めなくなるため、この重複検出の指摘を抑制する。*/
function activeSessionIsDisplayed(Scenario: Scenario): void {
  Scenario(
    "ramune が稼働中のグラフでは稼働中であることが表示される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given("session.state が active のグラフを返す graphSource がある", () => {
        graphSource = createFakeGraphSource(createGraphWithActiveSession());
      });

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果に ramune が稼働中であることが表示される", () => {
        expect.hasAssertions();
        expect(view).toContain('data-session-active="true"');
        expect(view).toContain("稼働中");
      });
    },
  );
}

/*similarity-ignore: 上記と同じ理由（.feature との1対1対応を保つため共通化しない）。*/
function inactiveSessionIsDisplayed(Scenario: Scenario): void {
  Scenario(
    "ramune が非稼働のグラフでは非稼働であることが表示される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given("session.state が inactive のグラフを返す graphSource がある", () => {
        graphSource = createFakeGraphSource(createGraphWithInactiveSession());
      });

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果に ramune が非稼働であることが表示される", () => {
        expect.hasAssertions();
        expect(view).toContain('data-session-active="false"');
        expect(view).toContain("非稼働");
      });
    },
  );
}

/*similarity-ignore: 上記と同じ理由（.feature との1対1対応を保つため共通化しない）。*/
function pendingNodesAreGroupedByRunnability(Scenario: Scenario): void {
  Scenario(
    "pending ノードが実行可能と依存待ちに分けて一覧される",
    ({ Given: given, When: when, Then: then, And: and }) => {
      let graphSource: GraphSource;
      let view: string;

      given(
        "「start」が done、「n1」が実行可能な pending、「n2」が「n1」を待つ pending のグラフを返す graphSource がある",
        () => {
          graphSource = createFakeGraphSource(createGraphWithWaitingPendingNode());
        },
      );

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果で「n1」は実行可能、「n2」は依存待ちとして一覧される", () => {
        expect.hasAssertions();
        expect(view).toContain('data-node-row="n1" data-runnable="true"');
        expect(view).toContain('data-node-row="n2" data-runnable="false"');
      });

      and("描画結果に status ごとの件数が表示される", () => {
        expect.hasAssertions();
        expect(view).toContain('data-status-count="pending">2');
        expect(view).toContain('data-status-count="done">1');
      });
    },
  );
}

/*similarity-ignore: 上記と同じ理由（.feature との1対1対応を保つため共通化しない）。*/
function nodeResultIsReadableInList(Scenario: Scenario): void {
  Scenario(
    "done ノードの result が本文として読める形で一覧される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given("「t1」が done で summary「調査した結果」を持つグラフを返す graphSource がある", () => {
        graphSource = createFakeGraphSource(createGraphWithResult());
      });

      when("グラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: undefined });
      });

      then("描画結果の一覧に「調査した結果」が本文として含まれる", () => {
        expect.hasAssertions();
        // v2 の result は完了証跡の構造体であり、本文領域には構造を読ませる形で
        // 描画される（summary フィールドが読めることまでを見る。整形の形式は
        // lib/node-text の実装詳細）。
        expect(view).toContain('<pre class="node-result-body">');
        expect(view).toContain("調査した結果");
      });
    },
  );
}

/*similarity-ignore: 上記と同じ理由（.feature との1対1対応を保つため共通化しない）。*/
function selectedNodeDetailIsOpen(Scenario: Scenario): void {
  Scenario(
    "選択したノードの詳細だけが開いた状態で描画される",
    ({ Given: given, When: when, Then: then }) => {
      let graphSource: GraphSource;
      let view: string;

      given("「t1」が done で summary「調査した結果」を持つグラフを返す graphSource がある", () => {
        graphSource = createFakeGraphSource(createGraphWithResult());
      });

      when("「t1」を選択してグラフビューを読み込む", async () => {
        view = await loadGraphView({ graphSource, selectedNodeId: "t1" });
      });

      then("描画結果で「t1」の詳細が開いた状態になっている", () => {
        expect.hasAssertions();
        expect(view).toContain('<div class="node-detail" data-open="true">');
        expect(view).not.toContain('data-open="false"');
      });
    },
  );
}

// 公開エントリポイント（index.js）だけを import する（原則6「公開契約のみテストする」）。
describeFeature(feature, ({ Scenario }) => {
  pendingNextNodeIsHighlighted(Scenario);
  abortedNodeIsDisplayedAsIs(Scenario);
  blockedNodeIsDisplayedWithReason(Scenario);
  noGraphStateIsDisplayedWhenGraphDoesNotExist(Scenario);
  activeSessionIsDisplayed(Scenario);
  inactiveSessionIsDisplayed(Scenario);
  pendingNodesAreGroupedByRunnability(Scenario);
  nodeResultIsReadableInList(Scenario);
  selectedNodeDetailIsOpen(Scenario);
});
