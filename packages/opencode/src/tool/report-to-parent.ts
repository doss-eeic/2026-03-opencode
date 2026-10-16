
import { Effect, Schema } from "effect"
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

    return {
      description:
        "Send a short progress report to the parent session. " +
        "Use this only when you are running as a subagent. " +
        "The report is saved in the parent's conversation.",
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

          // 3. 親の会話に報告を保存する（noReply: true なので親は起こさない）
          const parent = yield* sessions.get(self.parentID)
          yield* ops.prompt({
            sessionID: parent.id,
            agent: parent.agent ?? ctx.agent,
            noReply: true,
            parts: [
              {
                type: "text",
                synthetic: true,
                text: `[子セッション ${ctx.sessionID} からの報告]\n${params.message}`,
              },
            ],
          })

          return {
            title: "Reported to parent",
            output: `親セッション ${parent.id} に報告を保存しました。`,
            metadata: { parentID: String(parent.id) } as ReportMetadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)