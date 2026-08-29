Feature: タスク登録ハンドラの観測可能性

  Scenario: 成功時は1本の成功ログを残す
    Given タスク登録ハンドラがある
    When タイトルが「買い物リストを作る」で呼び出す
    Then 記録されたログは1本だけである
    And ログのレベルは「info」である

  Scenario: 空タイトルは invalid-input 単独の理由で失敗し、client応答にサーバ専用情報が出ない
    Given タスク登録ハンドラがある
    When タイトルが空文字で呼び出す
    Then タスクの登録は失敗する
    And 失敗の理由コードには「invalid-input」だけが含まれる
    And 記録されたログは1本だけである
    And client向けのエラー応答に logDetails は含まれない

  Scenario: ストレージが継続的に失敗すると、storage-unavailable と retry-exhausted が両方立つ
    Given リポジトリへの保存が常に失敗するタスク登録ハンドラがある
    When タイトルが「買い物リストを作る」で呼び出す
    Then タスクの登録は失敗する
    And 失敗の理由コードには「storage-unavailable」と「retry-exhausted」の両方が含まれる
    And 記録されたログは1本だけである
    And client向けのエラー応答に logDetails は含まれない
