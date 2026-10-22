# 永続チャットからのバックグラウンド実行

PR1の永続チャットとPR2の途中報告を組み合わせて使うための起動設定です。リポジトリルートから次を実行します。

```sh
bun run dev:bot --port 4096
```

このコマンドは `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` と `examples/background-chat.json` を有効にしてサーバーを起動します。追加の指示は、窓口の `task` で `background=true` を使い、依頼への応答を終えてから途中報告と完了通知を受け取る方針です。子には有用な進捗を `report_to_parent` で送るよう伝えます。

通常のモデル・権限設定は維持します。通常の `dev` の動作は変更しません。既存サーバーが同じポートで動いている場合は別ポートを選んでください。

画面は別のターミナルで起動します。

```sh
cd packages/app
bun dev -- --host 127.0.0.1 --port 4444
```

PR1のsingle-sessionモードで http://127.0.0.1:4444 を開いて使います。

## 確認したこと

実際の `task`・`report_to_parent`・セッション保存処理と、ローカルの決定的な模擬モデルを使った統合テストで、次の順序を確認しています。

1. 親が子を `background=true` で起動し、依頼を受け付けた応答を返す。
2. 子がまだ実行中の間に、親へ途中報告が届き、親の応答が保存される。
3. 子の完了後、親へ完了通知が届き、親が結果を返す。

```sh
cd packages/opencode
bun test test/session/prompt.test.ts -t 'background demo delivers'
```

自然言語からのツール選択はモデルに依存します。この変更は指示と起動フラグだけを追加します。cron機能は含みません。報告IDの重複判定と親のvariant維持に関する既知の問題は修正していません。
