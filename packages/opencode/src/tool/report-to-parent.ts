
import { Effect, Schema, Scope } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import type { TaskPromptOps } from "./task"

export const Parameters = Schema.Struct({
  message: Schema.String,
})

// どの場合も同じ形で返すために、metadata の形を先に決めておく
type ReportMetadata = { parentID?: string }

export const ReportToParentTool = Tool.define(
  "report_to_parent",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    // 親への話しかけを別のフローで動かすための入れ物（task.ts 88行目と同じ）
    const scope = yield* Scope.Scope

    return {
      description:
        "Send a short progress report to the parent session. " +
        "Use this only when you are running as a subagent. " +
        "The parent will be woken up to read the report. " +
        "You do not need to wait for the parent's reply.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
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

          // 3. 親に報告を送って起こす
          //    forkIn で別のフローにするので、子は親の返事を待たない（デッドロックしない）
          //    失敗しても子の作業は止めない（Effect.ignore。inject と同じ）
          const parent = yield* sessions.get(self.parentID)
          yield* ops
            .prompt({
              sessionID: parent.id,
              agent: parent.agent ?? ctx.agent,
              parts: [
                {
                  type: "text",
                  synthetic: true,
                  text: `[子セッション ${ctx.sessionID} からの報告]\n${params.message}`,
                },
              ],
            })
            .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))

          return {
            title: "Reported to parent",
            output: `親セッション ${parent.id} に報告を送りました（親を起こします。返事は待ちません）。`,
            metadata: { parentID: String(parent.id) } as ReportMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)