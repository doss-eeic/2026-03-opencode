# 定期実行の設定ファイル・型定義

2026年10月19日。既存の子セッションへ、指定した日時に依頼文を送るための共通契約。

このPRは1回分の送信関数・共有型・チャットからの登録CRUDを提供する。PR1の永続セッションUIを依存コミットとして取り込んでいるが、GitHub上のPRはマージしない。**指定時刻の判定・繰り返し送信は未実装**。設定保存を実行開始と表示しない。

## 永続セッションのチャットから登録・管理する

リポジトリ標準の `packages/opencode` サーバーと、PR1の `VITE_OPENCODE_UI_MODE=single-session` を使う。UIが記憶したルートセッションのmetadataに、次の値を既存のセッションAPIで保存してから会話を開く。

- `opencode.schedulerOwner`: そのセッション自身のID
- `opencode.schedulerBaseURL`: 現在接続しているサーバーURL
- `opencode.schedulerTimezone`: ブラウザーのIANAタイムゾーン

そのセッションだけに `cron` ツールを公開し、実行時にも所有条件を再確認する。通常のセッション、子セッション、metadataをコピーしたフォークには公開しない。フルUIはこの印を付けない。これは既存APIで編集できる機能設定であり、認証や悪意あるローカルコードに対するセキュリティ境界ではない。

標準サーバーは互換APIを持ち、PR1ではv1接続として判定される。今回のツールはこの互換実行経路に実装した。**互換APIを持たないV2専用サーバーのネイティブツール実行には未対応**。その接続では従来どおりチャットを利用できるが、cron用metadataの登録は行わない。

例えば「毎朝7時に、雨が降るなら教えて。日本時間で」と依頼すると、モデルが子セッションのIDと繰り返し条件を構造化して `cron` に渡す。送信先は同じプロジェクト・ディレクトリーの直接の子セッションに限定する。新しい送信先が必要なら既存の `task` ツールで担当を準備する。登録しただけで予定時刻の処理を実行しない。

| action   | 入力と動作                                                                          |
| -------- | ----------------------------------------------------------------------------------- |
| `create` | `id`, `sessionID`, `text`, `recurrenceRules`。`enabled` は省略時true、`name` は任意 |
| `list`   | このまとめ役が管理する設定を一覧にする                                              |
| `get`    | `id` の設定を取得する                                                               |
| `update` | `id`, 現在の `revision`, `patch`。`enabled: false/true` で停止・再開する            |
| `delete` | `id`, 現在の `revision`。設定を削除する                                             |

`baseURL` はモデルに入力させず、まとめ役の接続情報から決める。新規登録の `id` は `まとめ役のセッションID:指定したid` に正規化し、異なるまとめ役の同名設定が衝突しないようにする。更新・削除には返されたIDを使う。同じまとめ役では短い元のIDでも参照できる。停止・再開ではIDを変えない。重複作成と古い版での更新・削除はエラーにする。

### 保存と予定計算担当への接続

`src/schedule/registration.ts` の `ScheduleRegistration.Service.execute(ownerID, input)` が登録窓口。保存する1件は `Registration = ScheduleConfig & { revision: number }`。`revision` は1から増加し、`nextRunAt` や `Run` は混ぜない。

保存先はOpenCodeのデータディレクトリー配下の `schedule-configs/<SHA256(ownerID)>.json`。内容は `Registration[]`。ファイル名に設定IDや依頼文を使わない。単一サーバープロセス内の更新を直列化し、一時ファイルからrenameして置き換える。壊れたファイルを空の設定で上書きしない。別プロセスからの設定ファイルへの書き込みは未対応なので、予定計算担当は設定を読み、実行状態を別ストアに持つ。

予定計算担当は `Registration` の `revision` を設定版として読み、`baseURL` を保持したまま、RRULEの検証、`nextRunAt` の計算、`Run` の作成・送信を実装する。ファイル更新は再読み込みして反映し、無効・削除された設定の扱いを決める。実行の直前にもまとめ役と送信先が存在し、有効な所有関係を保っていることを確認する。削除後に同じ設定IDを再利用する運用や、複数サーバーから同じデータへ書く運用は、実行側を接続する前に墓標・版管理を含めて決める。

共有スキーマは日時・タイムゾーン・空でないRRULEを検証するが、RRULEの意味検証はまだ行わない。保存済み設定は**予定計算前の登録情報**であり、動作可能なスケジュールとして受理済みではない。ツール結果も常に `automaticExecution: "not_implemented"` を返す。

## 共通の型と入力検証

定義元は [`src/schedule/schema.ts`](../src/schedule/schema.ts)。各名前はZodスキーマと、そのスキーマから推論したTypeScript型の両方として公開する。型だけを複製せず、このファイルを共有する。

```typescript
import { ScheduleConfig } from "@/schedule/schema"

const config = ScheduleConfig.parse(input)
```

スキーマは未知のフィールドを拒否する。設定ファイルに実行状態を混ぜたり、フィールド名を誤ったりした場合もエラーにする。

## 1回分の送信

```typescript
type SendConfig = {
  baseURL: string // 接続先サーバーのURL
  sessionID: string // 送信先セッションID
  text: string // 依頼文
}
```

`src/schedule/send.ts` の `sendPrompt(config)` はこの3項目だけを受け取り、既存のセッションに1回送る。`directory` はセッション情報から取得する。手動で送るコマンドは提供しない。

## 定期実行の設定と状態

```typescript
type RecurrenceRule = {
  dtstart: string // 現地の開始日時。YYYY-MM-DDTHH:mm:00
  timezone: string // IANAタイムゾーン。例：Asia/Tokyo
  rrule: string // RFC 5545のRRULE値。RRULE:という接頭辞は付けない
}

type Schedule = {
  id: string
  name?: string
  revision: number
  enabled: boolean
  sessionID: string
  text: string
  recurrenceRules: RecurrenceRule[]
  nextRunAt: number | null
}

type ScheduleConfig = Omit<Schedule, "revision" | "nextRunAt"> & {
  baseURL: string
}
```

- `id` は設定の識別子。停止・再開でも変えない。状態ストア内で一意に扱い、`baseURL` との対応も保持する。
- `revision` は1から始まる整数。設定を変更すると増やす。`enabled` の変更も設定変更に含む。単に次の予定へ進めるときは増やさない。
- `recurrenceRules` は1件以上。各ルールが作る予定の和集合として扱い、同じUTC日時に重なる予定は1回にまとめる。
- `dtstart` はオフセットや `Z` を付けない現地日時で、秒は `00`。`timezone` と組で解釈する。
- 共有スキーマは日時形式・実在する日付・タイムゾーン名・必須項目を検証する。`rrule` は空白だけの値を拒否するが、**RRULEの文法や意味までは検証しない**。実行可能な予定として受理する前に、予定計算側がRFC 5545対応パーサーで検証する。使用ライブラリと対応する繰り返し条件は別途決める。
- `nextRunAt` は次回予定のUTCミリ秒数。停止中は必ず `null`。有効な設定でも、有限回の繰り返しが終了した場合は `null` を許す。
- `enabled && nextRunAt !== null && nextRunAt <= now` が実行対象の判定条件。遅れた予定をすべて実行するか見送るかは、まだ決めていない。
- 手書きファイルやチャットからの登録入力は `ScheduleConfig` とする。`revision` と `nextRunAt` は登録・予定計算側が管理し、利用者に入力させない。

`baseURL` は接続情報なので `ScheduleConfig` に置く。`Schedule` だけでは送信先サーバーを復元できないため、状態を保存するときにこの対応を失わないこと。登録設定の保存形式は上記の `Registration[]`。実行状態の保存形式は未決定。

## 設定例：毎日07:00と21:00

[`examples/schedules/daily-check.json`](../examples/schedules/daily-check.json) は、日本時間で同じセッションへ送る設定例。`sessionID` を実在する子セッションのIDに置き換える。

```json
{
  "baseURL": "http://127.0.0.1:4096",
  "id": "daily-check",
  "name": "毎日の確認",
  "enabled": true,
  "sessionID": "<送信先のID>",
  "text": "作業の進捗を確認して報告してください。",
  "recurrenceRules": [
    {
      "dtstart": "2026-10-20T07:00:00",
      "timezone": "Asia/Tokyo",
      "rrule": "FREQ=DAILY;BYHOUR=7,21;BYMINUTE=0;BYSECOND=0"
    }
  ]
}
```

`sendPrompt` はこの形式を直接受け取らない。定期実行側が、次の構造に変換して `sendPrompt` に渡す。

```typescript
const message: SendConfig = {
  baseURL: run.baseURL,
  sessionID: run.sessionID,
  text: run.text,
}
```

30分ごとの例は `FREQ=MINUTELY;INTERVAL=30;BYSECOND=0`。曜日ごとに時刻が異なる場合は `recurrenceRules` を分ける。

## 1回分の実行記録

```typescript
type RunStatus = "pending" | "dispatching" | "submitted" | "failed" | "unknown" | "skipped"

type Run = {
  id: string
  scheduleID: string
  scheduleRevision: number
  scheduledAt: number // 予定された日時。UTCミリ秒数
  baseURL: string
  sessionID: string
  text: string
  status: RunStatus
}
```

`Run` は予定1回分の独立した記録。`scheduleRevision`、`baseURL`、`sessionID`、`text` はその予定を実行記録にするときのスナップショットであり、後で設定を書き換えても変更しない。`scheduledAt` は実際に送った時刻ではなく、本来の予定日時。

| 状態          | 意味                                                |
| ------------- | --------------------------------------------------- |
| `pending`     | 実行記録を作成したが、送信には着手していない        |
| `dispatching` | 1つの実行担当が記録を取得し、送信処理に着手している |
| `submitted`   | 送信APIの受付を確認した。AIの作業完了ではない       |
| `failed`      | 未投入であると確定した                              |
| `unknown`     | 受け付けられたか判定できない。自動では送り直さない  |
| `skipped`     | 送信前に、明示的な方針によって見送った              |

基本の遷移は `pending → dispatching → submitted / failed / unknown`。見送りは `pending → skipped`。送信に着手した後のタイムアウトや切断を、一律に `failed` として再送してはいけない。`dispatching` のまま処理が落ちた場合も、配信状況を確認できるまで安全な再送とは扱わない。

### 保存実装が守ること

- **重複防止のキーは `(scheduleID, scheduledAt)`**。`revision` やルールの番号は含めない。同時刻のルールの重なりや、設定変更の前後で同じ予定を二重に作らないため。
- キーの一意性と `pending → dispatching` の取得処理は、保存先の一意制約・トランザクション・比較更新などで原子的に実装する。型を定義するだけでは重複送信は防げない。
- 複数の実行担当が同じ `Run` を送らないこと。読み出してから状態を書くだけの実装にはしない。
- 設定更新は `revision` を使って競合を検出し、古い版を読んだ担当が新しい設定や次回予定を上書きしないこと。
- これらはローカルの二重起動を防ぐ契約であり、ネットワーク越しの厳密なexactly-once配信を保証しない。成否不明の送信は履歴で確認する。

## 並行開発の分担

| 担当               | 入出力と責務                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| チャットからの登録 | 依頼から `ScheduleConfig` を作り、共有スキーマで検証して登録処理へ渡す。停止・再開・変更では同じ `id` を使う |
| 登録・予定計算     | RRULEを検証し、`revision` と `nextRunAt` を付けて `Schedule` を管理する。複数ルールの同時刻を統合する        |
| 保存・実行         | `Run` の作成と原子的な取得、送信、受付状態の保存を行う。送信には `SendConfig` の3項目を渡す                  |

APIルートや関数名、保存方式はこの契約では固定しない。各担当が先に型を利用できるようにする。

## 未決定のこと

- 予定計算側での設定ファイルの読み込み・再読み込み方法（登録側の保存・削除は実装済み）
- `Schedule`・接続情報・`Run` の保存先とトランザクション方法
- 初回読み込み、停止・再開、長時間停止後に過去の予定をどう扱うか
- RRULEの対応範囲、夏時間の欠落・重複時刻の扱い
- 送信先が処理中・削除済み・アーカイブ済みの場合の対応
- 設定変更や停止と、すでに作成・取得された `Run` が競合した場合の扱い
- 配信状況の照合方法、手動復旧・再試行の操作

`SendConfig` の送信処理に成功しても、AIの作業完了は保証しない。`unknown` からの自動再送は行わない。
