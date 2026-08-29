# bootstrap-template 質問仕様

この文書は、`webapp-blueprint` を clone した直後に AI Agent が実行する
`bootstrap-template` skill の質問仕様と実装契約を記録する設計正本である。

## 進行方式

1. 最初に「何を作りたいか」を自由記述で聞く。
2. `grill-with-docs` skill を起動する。`grill-with-docs` が要求する `grilling` と
   `domain-modeling` により、プロダクトの目的・利用者・語彙・境界・制約を、技術選定を
   始められる粒度まで具体化する。
3. `grill-with-docs`の一部として、具体化したproject briefを入力にrepository内の正本と最新の外部一次情報を
   まとめてLLM researchする。research結果には、推奨、根拠、trade-off、未解決点を含める。
4. research結果から該当するdiscussion nodeを開き、Agentの理解と推奨を提示しながら依存順にすべて完了する。
   discussionが一つでも未完了の間は通常の質問リストへ進まない。
5. research結果と全discussion decisionから、根拠と推奨回答を持つ質問をdependencyごとのnodeへまとめ、
   question workflowを生成する。
6. dependencyを満たしたquestion nodeを順に提示し、ユーザーがnode単位でまとめて回答する。
7. 回答によって新しい条件付きnodeが開いた場合はworkflowへ追加し、未解決nodeがなくなるまで続ける。
8. 回答をmaterializeし、`docs-triage`に従って機械検査・task・skill・現行規範・ADRへ振り分ける。

質問ごとに逐次調査を挟まない。web frameworkなどの候補を事前に固定せず、discussionより前に行う
`grill-with-docs`のresearchでプロダクト要件に合う候補を絞る。そのresearch結果をdiscussionとquestionの
共通入力にする。

## decision workflow

workflowはquestion単位ではなく、同じ先行decisionを共有し、ユーザーが文脈を保ったまままとめて回答できる
question集合をnodeとするdirected acyclic graphで表現する。

各nodeは少なくとも次を持つ。

- 安定したnode ID
- `discussion` / `research` / `question` / `materialization`のkind
- nodeが開くために完了している必要があるpredecessor node ID
- nodeをskipできる明示的な条件
- node内のquestion ID一覧
- Agent recommendationと根拠を生成するためのresearch input
- nodeの完了条件と、回答によって開くsuccessor node
- 回答をmaterializeする正本とquality gate

question node内には、先行questionの回答がなければ意味が決まらないquestionを混在させない。その場合は
別nodeへ分割しedgeで接続する。一方、同じrecommendationとtrade-offを共有するquestionを細切れのnodeへ
分割しない。

### workflow stage gate

```text
brief -> grill-with-docs research -> discussions -> questions -> materialization -> docs-triage -> complete
```

- `brief`がresearch可能な粒度になるまで`grilling`を続ける。
- discussionを開く前に、`grill-with-docs`によるconsolidated researchを完了する。
- `discussion` nodeはresearch結果、Agent recommendation、未解決点を入力にする。
- `question` nodeはresearchと、project briefから開いた全discussion nodeの両方が完了した後だけ開く。
  discussionへ戻る必要が判明した場合、questionへの回答を続けず、新しいdiscussion nodeを追加する。
  追加discussionに新しい外部事実が必要ならquestion stageへ戻る前に影響範囲だけを再researchする。
- すべての必須・条件付きquestion nodeが完了するまでmaterializationを開始しない。
- predecessor未完了、skip条件未確定、回答矛盾のいずれかがあればfail fastし、後続nodeを開かない。

### canonical node graph

質問内容の追加・削除があっても、次の責務nodeへ分類する。predecessorの回答によって意味が変わる質問は
同じnodeへ置かない。

```text
B0 project brief / grill-with-docs
  -> R0 consolidated LLM research / grill-with-docs
  -> D* all applicable technical discussions
  -> Q0 backend language
  -> Q1A repository topology
  -> Q1B repository toolchain
  -> Q2A backend core
     -> Q2B API surface
     -> Q2C contract implementation
        -> Q2D OpenAPI change policy
  -> Q3 frontend architecture and design system
  -> Q4A runtime and infrastructure scope
     -> Q4B platform, data services and local development
     -> Q4F feature flags
  -> Q5 database implementation
  -> Q6A testing baseline
     -> Q6G1 Go property testing
     -> Q6G2 Go fuzzing
     -> Q6G3 Go mutation testing
     -> Q6G4 Go test redundancy / Tobari
     -> Q6G5 Go dupl policy
  -> Q7 observability implementation
  -> Q8 automation, preview and AI review
  -> M0 materialization
  -> T0 docs triage
  -> C0 bootstrap completion
```

### question node registry

| node   | predecessor                                 | open / skip                                                      | decision authority                                                                          |
| ------ | ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Q0`   | `D*`                                        | 常時。skip不可                                                   | backend language: Go / TypeScript                                                           |
| `Q1A`  | `Q0`                                        | 常時。skip不可                                                   | single package / monorepo / multiple repository                                             |
| `Q1B`  | `Q1A`                                       | 常時。workspaceとorchestratorだけmonorepo以外でskip              | package manager、workspace、orchestrator、mise、pin/cooldown、dependency update automation  |
| `Q2A`  | `Q0`                                        | backendがある場合。現templateではskip不可                        | backend architecture、framework、module boundary、composition / DI、lifecycle、Go error実装 |
| `Q2B`  | `Q2A`                                       | APIあり。APIなしならskip                                         | consumer、公開範囲、streaming、versioning                                                   |
| `Q2C`  | `Q2B`                                       | APIあり。languageとAPI方式でbranch                               | Go RPC implementation / TypeScript contract layer                                           |
| `Q2D`  | `Q2C=TypeSpec`                              | TypeSpec -> OpenAPIのみ。それ以外skip                            | breaking-change detectorとCI拒否範囲                                                        |
| `Q3`   | `Q2B`の完了またはskip                       | frontendあり。frontendなしならskip                               | framework、rendering、state、component catalog、motion、design system                       |
| `Q4A`  | `Q1B`,`Q2A`,`Q3`                            | 常時。skip不可                                                   | deployment、external service、secret、infrastructureの必要範囲                              |
| `Q4B`  | `Q4A`                                       | infrastructure / data service / local複数serviceがある場合       | provider、runtime、IaC、database製品、storage、queue、secret manager、local URL / emulator  |
| `Q4F`  | `Q4A`                                       | rollout、kill switch、experiment等の用途がある場合。なければskip | feature flag基盤                                                                            |
| `Q5`   | `Q4B`でdatabase決定                         | databaseあり。databaseなしならskip                               | migration、query方式、library、責務の正本                                                   |
| `Q6A`  | `Q2C`,`Q3`,`Q5`の完了またはskip             | 常時。skip不可                                                   | contract test、BDD、E2E、browser、visual regression                                         |
| `Q6G1` | `Q0=Go`,`Q6A`                               | 複雑なinvariant / state machineあり                              | rapid / property-based testing policy                                                       |
| `Q6G2` | `Q0=Go`,`Q6A`                               | 外部入力parser等のboundaryあり                                   | native fuzz target、corpus、timing、budget                                                  |
| `Q6G3` | `Q0=Go`,`Q6A`                               | Goなら常時                                                       | gomu対象、operator、timing、mutation score                                                  |
| `Q6G4` | `Q0=Go`,`Q6A`                               | test redundancy / scenario coverage要件あり                      | Tobari採否、対象、計装、CI policy                                                           |
| `Q6G5` | `Q0=Go`                                     | Goなら常時                                                       | duplのthresholdと理由付き抑制。dupl採否は固定保証                                           |
| `Q7`   | `Q4B`,`Q6A`の完了またはskip                 | application telemetryがある場合                                  | logger、collector/exporter、metrics、error tracking、sampling、retention、local backend     |
| `Q8`   | `Q1B`,`Q3`,`Q4B`,`Q6A`,`Q7`の完了またはskip | AI reviewは常時。previewはcloud利用時だけ                        | PR AI review、preview environment                                                           |

`Q0`を最初のquestion nodeとする。Go / TypeScriptの回答によってGo固有nodeとcontract implementationを
branchする。frontendが存在する場合のTypeScript toolchainを、backend languageがGoという理由だけでskipしない。

database製品のauthorityは`Q4B`、schema migration / query implementationのauthorityは`Q5`とする。
これによりdeploymentとdatabase選択に依存するmigration質問が先に開く循環を防ぐ。visual regressionの
採否authorityは`Q6A`、preview environmentは`Q8`、local observability backendは`Q7`へ一本化する。

## skill lifecycle

- 初回専用 skill の名前は `bootstrap-template` とする。
- description で「clone 直後、project 実装開始前」に発動することを明記する。
- bootstrap 完了 marker が存在する場合、再 materialize せず明確に停止する。
- 完了時に project 固有の setup skill の雛形を現在の構成へ更新する。
- README と `AGENTS.md` の `bootstrap-template` 案内を setup skill の案内へ置き換える。
  `CLAUDE.md` は `AGENTS.md` のimportだけを保つ。
- `bootstrap-template` skill 自体は削除せず repository に残す。
- setup skill は判断を含む手順だけを持ち、決定的な処理は `mise` task / script を正本とする。
- setup・構成を変える PR では `docs-triage` により setup skill の更新要否を判定する。

## `bootstrap-template` skill の契約

### 発動条件

- `webapp-blueprint` を clone し、project 固有コードの実装を始める前に発動する。
- README と `AGENTS.md` は bootstrap 未完了時にこの skill を唯一の初期化入口として案内する。
  `CLAUDE.md` は `AGENTS.md` をimportする。
- bootstrap 完了 marker が存在する repository では再実行を拒否し、setup skill を案内する。

### 入力

- ユーザーによる「何を作りたいか」の自由記述
- `grill-with-docs` が具体化した目的、利用者、主要 workflow、domain vocabulary、境界、制約
- repository に存在する principles、design、ADR、recipes、materialized config
- 調査時点の公式 documentation、release、runtime/provider 制約

ユーザーがまだ決めていない事項を、skill が暗黙 default や推測で補完してはならない。

### `grill-with-docs` の利用

- 自由記述を受け取った直後に `grill-with-docs` を必ず起動する。
- `grill-with-docs` の `grilling` は、技術候補を選ばせるためではなく、research の入力となる
  project brief を具体化するために使う。
- `domain-modeling` は合意した domain vocabulary だけを glossary に記録する。技術選定や
  setup 手順を glossary に混ぜない。
- project brief が曖昧な間は research へ進まない。
- project brief の確定後に一度まとめて research し、技術 decision の質問リストを作る。
  各技術質問の途中で場当たり的に検索して候補を継ぎ足す運用にはしない。
- この文書の必須discussionは閉じた固定リストではない。`grill-with-docs` の過程で、project固有かつ
  後から変更しにくい基盤decision、複数の正当な解釈、重大な未解決点が見つかった場合、Agentは
  根拠を示してdiscussion項目を質問リストへ追加する。
- 追加discussionには、なぜ既存項目では扱えないか、今決める必要がある理由、決定によって影響する
  data model・contract・security boundary・deployment・operationsを記載する。
- 一般的なchecklistを無条件に展開しない。project briefから該当性を説明できないtopicは追加しない。

### research の契約

- template の既存採用品、明示的な空 slot、条件付き recipe、未配線候補を分離する。
- 外部候補は公式 documentation、公式 repository、標準仕様等の一次情報で確認する。
- version、保守状況、runtime、license、deployment 制約、導入・運用コストを確認する。
- 候補ごとに「何を満たすか」「何を失うか」「どの回答に依存するか」を記録する。
- template の既存選択を無条件に推薦せず、project brief に照らして反証を試みる。
- 推薦には根拠と trade-off を付ける。根拠を確認できない候補は推薦しない。

### 質問リストの契約

各質問は少なくとも次を持つ。

- 安定した question ID
- 質問が開くための先行 decision
- discussion / 自由記述 / 単一選択 / 複数選択 / template 前提確認の区分
- question text
- Agent の推奨回答と根拠
- 選択肢ごとの主要 trade-off
- 回答によって変わる tracked file、dependency、quality gate、運用
- 必須 / 条件付き / 任意
- 未回答または拒否時に停止する条件

一択の template 前提も、ユーザーが確認すべきものは質問リストへ含める。一方、単一の
quality check 入口など template が品質を保証するための内部実装は質問せず強制する。

技術候補を選ぶ質問だけでなく、複数の正当な解釈があり、ユーザーと話し合って初めて
decision が形成される topic を `discussion` として扱う。discussion は固定選択肢への回答を
強制せず、Agentが現時点の理解、推奨する解釈、未解決点、具体的scenarioを提示し、ユーザーが
まとめて補足・訂正できるようにする。

### materialization と docs triage

回答が確定するたびに、この設計正本と bootstrap の decision state を更新する。全回答後、
`docs-triage` を各 decision に適用する。

- 静的に検査できる規約は linter / ast-grep / architecture test / policy test にする。
- 決定的な処理は `mise` task / script / generator にし、skillへコマンド列を複製しない。
- 全taskで必要な普遍規範だけを root agent instructions に置く。
- setup時だけ必要な判断手順はproject固有 setup skill に置く。
- hard to reverse、surprising、real trade-off の3条件を満たす決定だけADRにする。
- domain vocabulary だけを glossary に置く。

### 出力

- 確定した project brief と domain glossary
- 根拠付き recommendation と全回答済み question state
- 回答に従って materialize された source/config/task/quality gate
- 必要な ADR と現行規範
- project 固有に更新された setup skill
- bootstrap 完了 marker
- README / `AGENTS.md` の setup skill への入口差し替え

### 完了条件

- 必須または条件付きで開いた question がすべて回答済みである。
- 回答、tracked decision、ADR、materialized files に drift がない。
- 選ばなかったstackの実装、dependency、互換layer、歴史的痕跡を残さない。ただし`Q8`で明示的に
  disabled保持すると合意したtemplate同梱PR AI review workflowは例外とし、automatic triggerが無効で
  あることと再有効化手順を現行仕様として記録する。credential未設定をdisabled状態として利用しない。
- setup skill が clone 後の実構成を再現でき、決定的処理は canonical task を呼ぶ。
- canonical `mise run check` が成功する。
- 完了 marker を書いた後、README と `AGENTS.md` が bootstrap を通常入口として案内していない。

## `grill-with-docs`でresearch前に確定するproject brief

このsectionはtechnical discussionではない。LLM researchの入力を作るため、`grilling`で確定する。

### `product.intent-and-phases` — 目的・成功条件・非対象・phase

最初の「何を作りたいか」という自由記述を、research と設計に使える project brief へ
具体化するため、次を話し合う。

- 誰のどの問題を解決し、現在の代替手段から何を改善するか。
- 成功を判断できる観測可能な状態は何か。
- 最初の release に含める範囲と、明示的に作らない範囲は何か。
- 最終的に実現したい user context と、段階的に届ける phase をどう分けるか。
- 各 phase が、ユーザーにとって単独で意味のある outcome を完結しているか。

phase は frontend / backend / database のような技術層で分断しない。ユーザーが目的を達成する
一連の文脈を保った vertical slice とし、後続 phase の未実装を知らなければ何も完了できない
半端な導線を作らない。将来構想を初期 scope から外す場合も、最終的な user context と接続点を
失わない形で非対象を記録する。

### `product.actors-and-roles` — 利用者・actor・role・利用文脈

persona資料を作ること自体を目的にせず、authorization、tenant、audit、workflow、UI境界を
決められる粒度で次を話し合う。

- primary / secondary user、admin、operator、support等のroleは誰か。
- human以外のsystem actor、service account、CI agentは存在するか。
- 誰が誰のために操作し、代理操作があるか。
- 個人、organization、tenantのどの境界でdataと権限を分けるか。
- 同じ人物が複数roleを持つか。role間のtrust boundaryはどこか。
- どの環境・端末・network contextで利用するか。

project briefから利用者がengineerだけだと分かっている場合も、一般的なpersona質問を繰り返さない。
「誰がsign inできるか」「どのIdP / organizationに所属していることを要求するか」「人間、CI、
service accountをどう区別するか」のように、後続設計へ直結する質問をストレートに提示する。

## research後、question workflow前に完了するtechnical discussion

固定選択肢へ還元できない技術設計をここに置く。research結果、Agent recommendation、未解決点を
提示して話し合い、該当する全項目が完了するまでquestion nodeを開かない。

ここに列挙した項目だけで終了しない。`grill-with-docs`のresearchでproject固有の重大なdecisionを
発見した場合は、既存項目で扱えない理由と影響範囲を示して追加discussionを生成する。

後から変更するとcontract、data、deployment、security、運用基盤を大きく作り直す具体的な技術設計に
限定する。一般的な可用性・復旧checklistのように、具体的な技術decisionへ接続していない項目は置かない。
先行回答によって無関係と判明したtopicは明示的にskipするが、取り返しのつかないdecisionを未回答の
defaultで進めない。

### `security.authentication` — 認証・identity・account基盤

認証が存在するprojectでは必須とし、完全なpublic accessで認証不要と明示された場合だけ開かない。
具体的なIdP、protocol、provider、library候補は先行researchで推薦し、このdiscussionで適合条件と採否を
確定する。

- 誰がsign inでき、どのIdP、organization、email domain等をidentityの根拠として信頼するか。
- 個人account、organization、tenantと外部identityをどう対応付けるか。
- human、CI、AI Agent、service accountをどう認証・識別するか。
- session / tokenの発行、保存、更新、失効の境界をどうするか。
- account無効化、organization離脱、credential失効をいつ反映するか。
- local developmentとproductionで、同じ認証contractをどう再現するか。

未回答のまま認証を仮実装したり、development用bypassをproductionへfallbackさせたりしない。

### `security.authorization` — 認可・permission・resource境界

認証とは別のdiscussionとして、認証済みprincipalに何を許可するかと、その判定を強制する技術境界を
決める。認証がなくてもpublic / anonymous主体に操作差がある場合は開く。

- role、permission、resource ownership、attribute、relationshipのどれで許可を表現するか。
- organization / tenant / project等、authorizationとdata isolationの境界をどこに置くか。
- API、application service、domain、databaseのどのlayerで判定を強制するか。
- human、CI、AI Agent、service accountへ異なる権限modelが必要か。
- public access、share link、delegation、代理操作を許可するか。
- policy変更、権限剥奪、cache invalidationをいつ反映するか。
- denialをAPI error、audit log、trace上でどう表現するか。

認証成功を認可成功として扱わず、UI表示の制御だけをsecurity boundaryにしない。

### `data.governance` — data分類・保持・削除・所在地（条件付き）

すべてのprojectで開かない。enterprise品質、sensitive data、compliance、複数tenant、監査、
data residency等の要件がproject briefまたはresearchで確認された場合に開く。

- PII、secret、credential、自由入力、生成content等をどう分類するか。
- 保存しないdataとsystem of recordをどこに置くか。
- retention、user/organization削除、export、backupからの削除期限をどうするか。
- data residency、region、法務・compliance制約があるか。
- log、trace、auditへ載せてよいdataは何か。

enterprise要件がないprojectへ網羅的なgovernance設計を強制しない。ただし条件が成立した場合は、
dataを保存し始める前に解決する。

### `data.persistence-design` — database・永続化設計

永続化が存在するprojectでは必須とする。永続化しないprojectでも、databaseを暗黙に追加せず
「databaseなし」と明示的に決定する。PostgreSQL、Firestore、SQLite等の具体的な製品候補は先行researchで
提示し、このdiscussionのdata契約を反映した`Q4B`で選ぶ。新しい外部事実が必要な場合だけ差分researchする。

- 何を永続化し、何を再計算・再取得できるものとして扱うか。
- entity、value、関係、所有者をどう捉えるか。
- 各dataのsystem of recordはどこか。
- primaryなwrite patternとread patternは何か。
- transaction boundaryをどこに置くか。
- strong consistencyとeventual consistencyをどこで要求するか。
- concurrent updateをどう検出し、競合をどう解決するか。
- command、job、外部callback等にどのidempotency契約が必要か。
- organization / tenantごとにdataをどう分離するか。
- schema migration、data migration、backfill、rollbackをどう行うか。
- 初期data量、増加率、保持期間、hot pathはどの程度か。
- databaseとsearch、analytics、queue、object storageの責務境界はどこか。

database製品から設計を逆算せず、data ownership、access pattern、整合性、変更・復旧契約を先に
確定する。未回答の事項をORMやdatabaseのdefault behaviorへ委ねない。

### `contract.api-design` — API contract設計

database schemaとdata ownershipが決まった後、具体的なframeworkやcode generatorを選ぶ前に、
consumerから観測可能なAPI contractを話し合う。APIが存在しないprojectでは開かない。

- resource / operationをどの単位で公開し、内部のdatabase schemaをどこまで隠すか。
- request、response、validation、pagination、filter、sortの契約をどう表現するか。
- errorをどのcode・detail・retryabilityでconsumerへ伝えるか。
- streaming、long-running operation、非同期完了をcontract上どう表すか。
- idempotency、concurrency control、timeout、cancellationをどう公開するか。
- contract変更、versioning、互換性の範囲をどうするか。

API contractをdatabase tableの機械的な公開にせず、consumerの利用単位と失敗時の振る舞いを正本にする。

### `architecture.sync-async-boundary` — 同期・非同期処理の境界（条件付き）

外部API、AI生成、file処理、notification等、request内で完了しない可能性がある処理を持つ場合に開く。

- request内で完了させる処理と、queue / background jobへ渡す処理をどう分けるか。
- jobの状態、結果、進捗、cancelをどのcontractとdata modelで表すか。
- retry、timeout、重複実行、idempotency、部分成功をどう扱うか。
- userまたはconsumerへ完了・失敗をどう通知するか。
- queue、database-backed job、workflow engineのどこまでを初期構成に含めるか。

### `errors.error-model` — error設計

内部error、API contract、user表示、retry、運用対応を一つの失敗モデルとして話し合う。

- errorをどの分類・code・原因・retryabilityで表現するか。
- domain上の拒否、入力不正、認証・認可、競合、依存先障害、内部障害をどう区別するか。
- どのlayerでcontextを付加し、どこで公開可能なerrorへ変換するか。
- user / API consumerへ公開してよいdetailと、内部だけに残す情報をどう分けるか。
- timeout、cancel、partial failure、panic / unhandled exceptionをどう扱うか。

### `observability.logging` — log設計

logger製品の選択前に「誰が、何のために、どう調査・監視へ使うか」を決める。

- operation単位のwide event / canonical log lineをどこで出すか。
- event category、level、outcome、service、request / trace / user等のfield契約をどうするか。
- error伝播中の重複logをどのboundaryで防ぐか。
- PII、credential、payload、stack traceの記録禁止・sanitizationをどう保証するか。
- audit、security、debug、analytics用途を同じlogへ混ぜるか分離するか。
- alertが必要なeventをmessage文字列ではなくどのfieldで識別するか。

audit logの要否を独立した固定質問にはしない。このdiscussionで必要性が確認された場合だけ、対象操作、
payload、改ざん耐性、保存先、閲覧権限、retentionの下位質問を生成する。

### `observability.tracing` — trace設計

単一serviceでもrequest、database、外部API、background jobを同一の処理として追跡する必要がある場合に
開き、分散構成では必須とする。

- trace / span boundaryとoperation名をどう定義するか。
- HTTP / RPC / queue / jobをまたぐcontext propagationをどう保証するか。
- error、retry、timeout、cancel、async continuationをspan上どう表現するか。
- 標準のautomatic instrumentationとdomain固有のcustom instrumentationをどう分けるか。
- log、metricと相関するidentifierとattributeをどう統一するか。
- sampling、sensitive attribute、retention、costの制約をどう扱うか。

### `runtime.configuration` — configuration・environment契約

具体的なconfiguration libraryやsecret managerを選ぶ前に、local / test / preview / productionで
設定をどう定義・検証・供給するかを話し合う。

- 通常の設定値、secret、build-time valueをどう区別するか。
- 必須設定のschema、型、起動時validationをどこで定義するか。
- environmentごとの差分をどこで管理し、誰が変更できるか。
- backend、frontend、worker間で設定をどう分離・受け渡すか。
- 設定変更にrebuild、redeploy、restartのどれが必要か。
- clientへ公開可能な値とserver限定値のboundaryをどう保証するか。
- 未設定、不正値、未知のkey、矛盾する設定をどうfail fastさせるか。

feature flagの採否はconfiguration契約へ暗黙に含めず、独立した質問で必要性を確認する。

## 質問リストへ含める項目（合意済み）

### `Q0` — Backend language

- `backend.language`: Go / TypeScript

### `Q1A` / `Q1B` — Repository topology / toolchain

- `repository.topology`: single package / monorepo / 複数repository
- `toolchain.javascript-package-manager`: JavaScript package manager
- `repository.workspace-manager`: workspace管理方式
- `repository.task-orchestrator`: monorepo task orchestrator
- `toolchain.mise-preflight`: miseを開発環境・tool version・taskの上位入口として使うことの確認
- `dependency.pin-policy`: 依存を完全pinし、公開後7日のcooldownを設けることの確認
- `dependency.update-automation`: dependency update automationを有効にし、選択したlanguage、package manager、GitHub Actions等の
  全ecosystemを更新対象にすることのpreflight確認。template搭載のDependabot設定を回答に合わせて
  materializeし、npmだけが更新されGo module等が黙って対象外になる状態を許可しない。

### `Q2A` / `Q2B` / `Q2C` / `Q2D` — Backend / API / contract

- `api.consumer-surface`: APIが存在する場合のconsumerと公開範囲: browser frontend専用 / mobile / CLI / 他service /
  外部顧客。streaming・双方向通信の要否と、public contractとしてversioning・互換性を維持する
  必要があるかも併せて確認する。
- `contract.go-rpc-implementation`: GoのRPC実装: `connect-go` / `grpc-go`
  - `connect-go` は Connect protocol だけでなく gRPC / gRPC-Web も扱えるため、質問軸は protocol ではなく server implementation とする。
- `contract.typescript`: TypeScriptの契約層: protobuf + ConnectRPC / TypeSpec -> OpenAPI -> zod
- `contract.openapi-change-policy`: TypeSpec -> OpenAPIを選んだ場合、OpenAPI breaking-change detectorとCIで拒否する変更範囲を
  researchして選ぶ。未選定のままpublic contractをmaterializeしない。
- `backend.architecture`: backend architecture。固定候補を先に見せず、domain complexity・外部境界・team規模等から調査する。
  web / RPC framework、module boundary、composition root、dependency injection、long-running componentの
  lifecycle / graceful shutdownを一つの質問群として扱う。通常規模ではconstructor手組みを推薦し、
  constructor graphが大きい場合だけWire、複数worker等のlifecycle orchestrationが必要な場合だけFx等を
  researchして推薦する。
- `errors.go-implementation`: `errors.error-model` discussionの後、Goを選んだ場合のerror実装方式を選ぶ: 標準`errors` /
  `morikuni/failure` / `github.com/newmo-oss/ergo` / researchで要件適合を確認した別候補。
  - 分類・code・attribute・stack traceが不要な小規模境界では標準`errors`を推薦する。
  - error分類とtransport / log severityへのmappingを中心にする場合は`morikuni/failure`を比較する。
  - `slog.Attr`によるstructured attribute、typed error code、stack trace、対応する`ergocheck`の
    machine enforcementが必要な場合は`ergo`を比較する。
  - libraryの選択前に、公開error contract、`errors.Is` / `errors.As`とのinterop、stack取得位置、
    sensitive attribute、serialization、logging boundaryを検証する。

#### `Q6G4` / `Q6G5` — Go test redundancy / static duplication policy

`backend language` の回答が Go を含む場合だけ、次の質問を開く。TypeScript のみの場合は
開かない。既存の `similarity-ts` は TypeScript の AST 類似度による重複関数検出であり、
`mise run check` の `similarity` ゲートで `similarity-ts . --fail-on-duplicates` を実行する。
Go のテストケースの「同じコードパスを測っている」ことは検出しないため、Tobari はその
代替ではなく、Go 側の追加分析候補として扱う。

- `quality.go-test-redundancy` — **条件付き / 単一選択**。Go のテストについて、通常の
  `go test`/カバレッジだけで足りるか、または Tobari の scoped coverage を採用して
  重複テスト分析を行うか。
  - **質問文**: Go のテストで、テストケースごとの到達コードパスを比較し、ほぼ同じ
    効果のテストを削減する分析が必要ですか。必要な場合、対象は通常の `go test` か、
    HTTP/gRPC の E2E を含む実行中サーバーのシナリオ単位の測定かを選んでください。分析結果を
    Agent / reviewの情報に留めるか、明示したthresholdでCIを失敗させるかも回答してください。
  - **導入時の下位質問**: CLI / libraryの同一version pin、`Cover` / `CoverWithName`を置く公開可能な
    instrumentation boundary、`TOBARI_COVERDIR`の分離、unit / E2Eごとの実行taskを確定する。
  - **Agent recommendation を生成する条件**: project brief に Go backend があり、かつ
    (a) テストケースの冗長性削減、または (b) E2E／HTTP／gRPC／並行アクセス／非同期
    goroutine のシナリオ別カバレッジが明記されている場合に限り、Tobari を候補として
    推薦する。単に Go を選んだだけ、または静的な重複コード検出だけが目的の場合は推薦しない。
  - **推薦根拠**: Tobari 公式 README は `runtime/coverage` に対する scoped coverage として、
    `tobari.Cover` / `CoverWithName` で測定範囲を分け、静的解析した関数依存関係から
    「通過すべき場所」を逆算すると説明している。`go test` ではテストごとの
    `tobari.json` / `tobari.toon` を出力し、公式 README の Agent Skills に
    `tobari-duplicated-tests-remover`（95% 超の同一コードパスを対象）が記載されている。
  - **重要な責務境界**: Tobari は Go 専用の scoped coverage／テスト効果分析であり、
    `similarity-ts` のような AST 類似度による静的な重複コード検出ではない。したがって
    Go を選んでも `similarity-ts` の TS 用責務を Go 用に読み替えず、Go の静的重複コードは
    固定gateの`golangci-lint/dupl`が担当する。Tobari 自体には重複率の CI 閾値や duplicate 検出時の
    fail オプションは README に記載されていないため、導入しても自動的に quality gate
    にはしない。分析結果を Agent／レビューの入力にするか、CI で失敗させるかは別 decision
    として回答を要求する。
  - **導入制約と運用**: CLI とアプリケーションの `github.com/goccy/tobari` library は
    同一 version でなければ fingerprint error になる。`GOFLAGS="$(tobari flags)"`
    により `go build` / `go test` を計装し、出力は `TOBARI_COVERDIR` で分離する。
    whole-program RTA は依存する型と interface call site に対して超線形になり得るため、
    `--exclude-analysis` は callback が戻らない package に限定して使う。CLI は Go
    toolchain と `toolexec` に依存し、計装のためにアプリケーション側 API 呼び出しも必要になる。
  - **Go/TypeScript 混在時の実行方針**: `mise run check` を唯一の入口として維持し、既存の
    全体 `similarity` は TS を対象に実行する。Tobari は Go module／Go の実行可能な
    テスト・E2E シナリオだけを対象にした別の条件付き task とし、TypeScript の test task
    や `similarity-ts` に `GOFLAGS`・Tobari の出力を混ぜない。Go 側で Tobari を選ばない
    場合も、通常の Go test／カバレッジを選んだ理由を tracked decision に残す。
  - **未回答時の停止条件**: Go のテスト冗長性またはシナリオ別カバレッジを要件に含めた
    のに、対象（unit / E2E）、測定単位、分析結果を CI fail にするか、Tobari の version
    pin と追加 API 設計が未決定なら、Go testing／quality gate の materialization を停止する。

- `quality.go-static-duplication-policy` — **条件付き / template前提確認**。Goを選んだ場合、
  固定gateの`golangci-lint/dupl`について、cloneとして報告するtoken thresholdと理由付き抑制の
  規約を確認する。採否は質問せず、threshold未回答のままtool defaultへ委ねない。抑制は対象箇所の
  変更理由が異なり共通化すべきでない理由を近傍へ記録し、fileやpackage全体を黙って除外しない。

### `Q5` — Database implementation

- `database.migration-tool`: 採用database、backend language、deployment方式から候補を推薦する。
- `database.query-strategy`: ORM / type-safe query builder / code generation / database driver + 生SQL。
- `database.query-library`: query方式に対応する具体的なlibraryを推薦する。
- `database.authority`: migrationとqueryの責務を一つのtoolへ暗黙に束ねず、選択理由と正本を確認する。

### `Q3` — Frontend architecture / design system

- `frontend.architecture`: web framework、rendering方式、APIから取得するserver stateのdata fetching・
  cache / invalidation、featureをまたぐclient stateの有無と管理方式、component単位のcatalog・
  review環境の要否、gesture・高度なanimation / motion要件を一つの質問群として扱い、project規模と
  frameworkに合う構成をまとめて推薦する。
- web framework・rendering・state管理の候補は固定リストを事前定義せず、最初の調査結果から
  質問を生成する。client stateがfeature内で閉じる場合はglobal state libraryを追加せず、designerや
  non-engineerを含むcomponent単位review要件がない場合はcomponent catalogを追加しない。通常の
  transitionで足りる場合はmotion libraryを追加せず、採用時はreduced-motionとvisual regressionへの
  影響も確認する。
- `frontend.design-system`: 既存brand / design tokenの有無、component libraryの採否、generated
  component sourceの所有・手編集可否、styling方式、theme対応を確認し、research後に候補を推薦する。
- `frontend.design-token-policy`: 採用toolとは別に、色・spacing・typography等をdesign token経由にする規律と、one-off valueを
  許可する条件を確認する。

### `Q6A` / `Q6G1` / `Q6G2` / `Q6G3` — Testing

- `testing.public-contract-only`: 外部から観測可能な振る舞いと公開契約だけをテストすることの確認
- `testing.bdd-scope`: BDD / Gherkinを使用する範囲
- `testing.e2e`: E2Eの要否、対象browser/runtime、実行timing、全件/smoke/affected、visual regression
- `testing.go-property`: Goを選び、有限のexampleへ列挙しにくいinvariantやstate machineがある場合、`rapid`による
  property-based testingを使うか確認する。採用時はproperty、generator、shrinking後の再現方法を決める。
- `testing.go-fuzz`: Goを選び、外部入力を解釈するparser、decoder、protocol、token、署名検証等がある場合、Go native
  fuzzingを積極的に使う。対象boundary、seed corpus、発見caseのregression test化、local / CI / scheduled
  実行のtimingとbudgetを確認する。該当boundaryのないpackageへ機械的にfuzz targetを増やさない。
- `testing.go-mutation`: Goを選んだ場合、`sivchari/gomu`によるmutation testingを使い、test suiteがmutationを検出できるか
  確認する。対象package、mutation operator、incremental / full実行のtiming、timeout、worker数、
  mutation score threshold、survived mutantの扱いを質問する。通常のcoverageやTobariの重複テスト分析で
  mutation scoreを代替したことにしない。

### `Q7` — Observability implementation

- `observability.otel-wide-event`: OpenTelemetry + wide eventを基本契約にすることの確認
- `observability.stack`: structured logger、trace exporter/collector、metrics backend、error tracking、
  sampling / retention、local observability backend

### `Q4A` / `Q4B` — Runtime / secrets / infrastructure

- `secrets.reference-only`: secretの実値をrepositoryに置かず、参照だけを管理することの確認
- `secrets.runtime-injection`: secret managerと実行時注入方式
- `infrastructure.scope`: 必要なinfrastructure、deployment、外部serviceの自由記述
- `infrastructure.stack`: 自由記述とプロダクト要件の調査後にprovider、runtime、IaC、state backend、database、storage、queue等の
  質問を生成する。preview environmentの採否は`Q8`だけが所有する。
- deployment 先が短命な identity federation を提供する場合はそれを使う。利用不能なら代替認証と rotation 方針を明示的に決定し、長期鍵へ黙って fallback しない。

### `Q4F` — Feature flags

- `runtime.feature-flags`: feature flag基盤が必要か。段階的rollout、対象user / tenant限定、kill switch、experiment等の
  具体的な利用目的がある場合だけ候補をresearchする。
- feature flagが不要という回答の場合、通常のconfigurationへflag相当の分岐を紛れ込ませない。

### `Q4B` — Local development services

- `local.services`: localでfrontend、backend、worker、database、cloud emulator等の複数serviceを動かす必要があるか。
- `local.stable-url`: 複数serviceがある場合、固定されたlocal hostname / URLを提供するか。
- `local.emulator`: 採用provider / datastoreがemulatorを提供する場合、localとCIのどこで利用するか。
- `local.production-parity`: Secure cookie、OAuth redirect、CORS等をproductionに近い条件で検証する必要があるか。
- 採用回答からlocal起動・停止・初期化をcanonical `mise` taskへmaterializeし、setup skillはそのtaskを
  案内する。port番号や起動commandをskillへ複製しない。

### `Q8` — Automation / preview / AI review

- `automation.preview-environment`: cloud環境を利用する場合、PRごとのpreview environmentが必要かを確認する。採用時はreusable
  workflowへの一元化、PR終了時のcleanup、短命credential、PRから確認可能なURL / 状態を固定契約とする。
- `automation.ai-review`: PR AI reviewを有効にするか: none / Claude / Codex / both。
- 有効化するproviderごとに、code / diffの外部送信、利用model、credential参照、cost、reviewの
  重複と責務を確認する。
- 選択しなかったproviderの同梱workflowは削除せず、automatic triggerが発火しない明示的な
  disabled状態で保持する。credential未設定や実行時failureをdisabled扱いへ丸めない。
- disabled状態と再有効化手順はworkflow近傍とproject固有setup skillから確認可能にする。

## 質問せず template が保証する項目（合意済み）

- local・CI・Agent の全品質ゲートは単一の canonical `mise run check` から実行可能にする。
- CI は初期状態では常に全件実行する。affected execution、remote cache、実行段階の分割等は、実測で必要になってから追加する。
- 質問への回答によらず、silent fallback を作らず未回答・不正値・矛盾は fail fast する。
- AI Agentのcode intelligence基盤として、GoとTypeScriptの両方をfull supportするcodegraph MCPを
  常時配線する。対応状況は導入versionの公式language supportで検証し、どちらかが未対応なら黙って
  配線せずbootstrapを停止する。indexはrepository-localに管理し、telemetryは無効化する。起動・更新等の
  決定的処理はcanonical `mise` taskを正本とし、setup skillへcommandを複製しない。
- local development環境はdirenv + miseを固定入口とし、`.envrc`からrepository-local PATHを設定して
  `pkf hooks install`を冪等に実行する。hook定義の正本は`Taskfile.pkl`一本とし、pre-commitへ軽量検査、
  pre-pushへsecret検査を配線する。`.pre-commit-config.yaml`との二重管理を作らない。
- template搭載のsecurity / static scanはすべて有効にする。secret、dependency、source、IaC、containerの
  各scanは対象artifactが存在した時点で自動的にcanonical gateへ含め、languageやpackage managerの変更に
  対象を追従させる。CodeQL等がrepository visibilityやprovider制約で利用不能な場合、黙ってskipせず、
  同等のlocal / CI gateを明示的に選定・materializeできるまでbootstrapを完了しない。
- repository documentationのon-demand検索基盤としてblume-docs MCPを常時配線する。codegraph MCPは
  code、blume-docs MCPはdocumentationを担当し、root agent instructionsへ内容を複製しない。
- observability stackをmaterializeした場合、applicationがtelemetryを生成するunit testだけで完了せず、
  collector / backendを隔離環境で起動し、trace・logの到達とidentifierによる相関をintegration testで
  検証する。このtestもcanonical `mise run check`から実行可能にする。
- Goを選んだ場合、静的な重複コード検出は`golangci-lint/dupl`を固定gateとして有効にし、canonical
  `mise run check`へ含める。TypeScriptの`similarity-ts`、Goの`dupl`、Goの重複テスト分析候補Tobariを
  別責務として扱い、一つの検出器が他の責務を満たしたことにしない。
- Goを選んだ場合、golangci-lint v2は`linters.default: all`を起点にする。個別linterのallowlist運用へ
  反転せず、誤検知、責務重複、採用technologyとの不適合が実証されたlinterだけを`disable`へ追加する。
  無効化には対象、具体的なfailure、他のmachine gateが責務を持つ場合はその正本を近傍へ記録し、
  package / test file全体のblanket exclusionを既定にしない。`govet`等が内部analyzerのall-on設定を
  提供する場合も同じ方針を適用する。
- golangci-lintはexact pinと7日cooldownを適用する。upgradeで新しいlinterがall setへ入った場合は
  自動的にgate対象とし、失敗を旧allowlistへ戻して解消しない。採用可否をreviewし、不適合なら理由付き
  blacklistへ追加する。config schema validationとenabled / disabled一覧の検査をcanonical gateへ含める。
- golangci-lint v2ではformatterが`linters`と別sectionであるため、formatterは重複するauthorityを
  無差別にall-onせず、gofumpt、gci、golines等の互換な責務を明示して有効化する。
- project開始時、現在のcoding agentがRamune integrationへ対応している場合はRamune MCP、hooks、
  instructionsを自動配線する。ただしbootstrap直後はsessionを`inactive`に保ち、具体的なtask graphを
  作成して作業を開始するときだけ`ramune_start`でactive化する。対応していないagentへ互換shimを作らず、
  未対応であることをsetup結果へ明示する。壊れたsession stateをinactiveへ丸めない。

## bootstrap の固定discussionに含めない項目（合意済み）

- domain vocabulary、業務rule、状態遷移の網羅的な設計。これらを記録・更新する正本は必要だが、
  bootstrapで完成させる対象にはしない。`grill-with-docs` 中にresearchや初期decisionへ必要な語彙が
  判明した場合だけ、project briefと最小限のglossaryへ記録し、詳細は実装とdomain理解の進展に
  合わせて継続的に整備する。
- Go containerのbuild実装として`ko`かmulti-stage Dockerfileかを選ぶこと。bootstrapでuserへ質問せず、
  deployment先とartifact要件が確定した後、Go binary以外のasset / native library / OS packageの有無から
  Agentがmaterializeする。Dockerfileを選んだ場合のlint等もその回答から決定的に追加する。

## 質問リストに含めない項目（合意済み）

- TypeScript向けproperty-based testingの採否。Goでは`rapid`を条件付き質問として扱うが、同じ質問を
  TypeScriptへ機械的に展開しない。project固有のresearchで不可欠と判明した場合は、
  `grill-with-docs`から追加discussion / 質問を生成する契約に委ねる。
- TypeScriptのcontract外runtime schema validatorを独立して選ぶ質問。TypeSpec -> OpenAPI等の
  contract回答と`runtime.configuration` discussionから決定的にmaterializeし、生成済みZod、
  JSON Schema SSoTに対するAjv等を再質問しない。既存contractで覆われないruntime boundaryと実測した
  bundle制約がある場合だけ、researchから追加質問を生成する。

## 未検討

- 複数質問をまとめて提示・回答するinterface。bootstrap本体とは分離して候補案だけを調査し、採否は後で決める。
