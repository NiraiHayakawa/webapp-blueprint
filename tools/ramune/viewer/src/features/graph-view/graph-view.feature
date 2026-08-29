Feature: グラフビューの読み込み

  Scenario: 依存を満たした pending ノードが次に選ばれるノードとして強調される
    Given 「start」が done、「n1」が pending で dep に「start」を持つグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果に「n1」を次のノードとして強調するマーカーが含まれる

  Scenario: aborted ノードを含むグラフはそのまま表示される
    Given 「start」が done、「n1」が aborted なグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果に「n1」が aborted として表示される

  Scenario: blocked ノードとその理由が表示される
    Given 「start」が done、「n1」が blocked で理由「依存が複雑すぎた」を持つグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果に「n1」が blocked としてその理由とともに表示される

  Scenario: グラフがまだ存在しない場合は「まだありません」という状態が表示される
    Given .ramune/graph.json がまだ存在しない graphSource がある
    When グラフビューを読み込む
    Then 描画結果に「グラフがまだありません」という状態が含まれる

  Scenario: ramune が稼働中のグラフでは稼働中であることが表示される
    Given session.state が active のグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果に ramune が稼働中であることが表示される

  Scenario: ramune が非稼働のグラフでは非稼働であることが表示される
    Given session.state が inactive のグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果に ramune が非稼働であることが表示される

  Scenario: pending ノードが実行可能と依存待ちに分けて一覧される
    Given 「start」が done、「n1」が実行可能な pending、「n2」が「n1」を待つ pending のグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果で「n1」は実行可能、「n2」は依存待ちとして一覧される
    And 描画結果に status ごとの件数が表示される

  Scenario: done ノードの result が本文として読める形で一覧される
    Given 「t1」が done で summary「調査した結果」を持つグラフを返す graphSource がある
    When グラフビューを読み込む
    Then 描画結果の一覧に「調査した結果」が本文として含まれる

  Scenario: 選択したノードの詳細だけが開いた状態で描画される
    Given 「t1」が done で summary「調査した結果」を持つグラフを返す graphSource がある
    When 「t1」を選択してグラフビューを読み込む
    Then 描画結果で「t1」の詳細が開いた状態になっている
