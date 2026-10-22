
import { Effect, Schema, Scope } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import type { TaskPromptOps } from "./task"

export const Parameters = Schema.Struct({
  message: Schema.String,
})

// どの場合も同じ形で返すために、metadata の形を先に決めておく
type ReportMetadata = {
  parentID?: string
  callID?: string
  duplicate?: boolean
}

export const ReportToParentTool = Tool.define(
  "report_to_parent",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    // 親への話しかけを別のフローで動かすための入れ物（task.ts 88行目と同じ）
    const scope = yield* Scope.Scope
    // 送った報告の callID を覚えておく（同じ呼び出しが2回動いても、2回目は送らない）
    // サーバーを再起動すると消える（再起動後の復旧は MVP の範囲外）
    const sent = new Set<string>()

    return {
      description:
        "Send a short progress report to the parent session. " +
        "Use this only when you are running as a subagent. " +
        "The parent will be woken up to read the report. " +
        "You do not need to wait for the parent's reply.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // 0. 同じ呼び出しの2回目なら、何もしない
          if (ctx.callID && sent.has(ctx.callID)) {
            return {
              title: "Already reported",
              output: `この報告（報告ID ${ctx.callID}）はもう送りました。`,
              metadata: { callID: ctx.callID, duplicate: true } as ReportMetadata,
            }
          }

          // 1. 自分のセッションを調べて、親がいるかを確かめる
          const self = yield* sessions.get(ctx.sessionID)
          if (!self.parentID) {
            return {
              title: "No parent",
              output: "このセッションには親がいないので、報告は送りませんでした。",
              metadata: {} as ReportMetadata,
            }
          }

          // 2. 話しかける機能（task.ts の inject と同じもの）を取り出す
          //    ない場合はコードの不具合なので、失敗（fail）ではなく die で止める
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops) {
            return yield* Effect.die(new Error("report_to_parent requires promptOps in ctx.extra"))
          }

          const parent = yield* sessions.get(self.parentID)

          // 親の variant を引き継ぐ（渡さないと prompt.ts が親の variant を defaultに書き換える）
          // model は渡さなくても prompt.ts が親の今のモデルを引き継ぐので、variant だけ渡す
          const variant =
            parent.model?.variant && parent.model.variant !== "default" ? parent.model.variant : undefined

          // 3. 送る直前に「送った」と記録する（ここより前で終わったときは記録しない）
          if (ctx.callID) sent.add(ctx.callID)

          // 4. 親に報告を送って起こす
          //    forkIn で別のフローにするので、子は親の返事を待たない（デッドロックしない）
          //    失敗しても子の作業は止めない（Effect.ignore。inject と同じ）
          yield* ops
            .prompt({
              sessionID: parent.id,
              agent: parent.agent,
              ...(variant ? { variant } : {}),
              parts: [
                {
                  type: "text",
                  synthetic: true,
                  text: `[子セッション ${ctx.sessionID} からの報告 / 報告ID ${ctx.callID ?? "なし"}]\n${params.message}`,
                },
              ],
            })
            .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))

          return {
            title: "Reported to parent",
            output: `親セッション ${parent.id} に報告を送りました（親を起こします。返事は待ちません）。`,
            metadata: { parentID: String(parent.id), callID: ctx.callID } as ReportMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)