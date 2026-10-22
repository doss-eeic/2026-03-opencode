
import { afterEach, describe, expect } from "bun:test"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { ReportToParentTool } from "../../src/tool/report-to-parent"
import type { TaskPromptOps } from "../../src/tool/task"
import type { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

// task.test.ts と同じテスト用の環境
const layer = LayerNode.compile(
  LayerNode.group([
    Agent.node,
    BackgroundJob.node,
    EventV2Bridge.node,
    Config.node,
    CrossSpawnSpawner.node,
    Session.node,
    SessionProjector.node,
    SessionRunState.node,
    SessionStatus.node,
    Truncate.node,
    ToolRegistry.node,
    Database.node,
    RuntimeFlags.node,
    Ripgrep.node,
  ]),
)

const it = testEffect(layer)

// prompt が呼ばれたら記録するだけの、にせものの promptOps
function stubOps(onPrompt: (input: SessionPrompt.PromptInput) => void): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        onPrompt(input)
        // report_to_parent は返り値を使わないので、中身は空でよい
        return {} as SessionV1.WithParts
      }),
  }
}

function makeCtx(sessionID: Tool.Context["sessionID"], promptOps: TaskPromptOps, callID?: string): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    agent: "general",
    abort: new AbortController().signal,
    callID,
    extra: { promptOps },
    messages: [],
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

// forkIn で別のフローになった prompt が動き終わるのを待つ
const settle = Effect.gen(function* () {
  for (let i = 0; i < 5; i++) yield* Effect.yieldNow
})

describe("tool.report_to_parent", () => {
  it.instance("sends a report to the parent session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "parent" })
      const child = yield* sessions.create({ parentID: parent.id, title: "child" })
      const tool = yield* ReportToParentTool
      const def = yield* tool.init()

      const seen: SessionPrompt.PromptInput[] = []
      const ops = stubOps((input) => seen.push(input))

      const result = yield* def.execute({ message: "途中経過です" }, makeCtx(child.id, ops, "call-1"))
      yield* settle

      expect(result.title).toBe("Reported to parent")
      expect(seen).toHaveLength(1)
      expect(seen[0]?.sessionID).toBe(parent.id)
      expect(seen[0]?.noReply).toBeUndefined()
      expect(JSON.stringify(seen[0]?.parts)).toContain("途中経過です")
      expect(JSON.stringify(seen[0]?.parts)).toContain("call-1")
    }),
  )

  it.instance("does not send the same callID twice", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "parent" })
      const child = yield* sessions.create({ parentID: parent.id, title: "child" })
      const tool = yield* ReportToParentTool
      const def = yield* tool.init()

      let count = 0
      const ops = stubOps(() => count++)

      const first = yield* def.execute({ message: "1回目" }, makeCtx(child.id, ops, "call-dup"))
      const second = yield* def.execute({ message: "1回目" }, makeCtx(child.id, ops, "call-dup"))
      yield* settle

      expect(count).toBe(1)
      expect(first.title).toBe("Reported to parent")
      expect(second.title).toBe("Already reported")
      expect(second.metadata.duplicate).toBe(true)
    }),
  )

  it.instance("sends reports with different callIDs separately", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "parent" })
      const child = yield* sessions.create({ parentID: parent.id, title: "child" })
      const tool = yield* ReportToParentTool
      const def = yield* tool.init()

      let count = 0
      const ops = stubOps(() => count++)

      yield* def.execute({ message: "1つ目" }, makeCtx(child.id, ops, "call-a"))
      yield* def.execute({ message: "2つ目" }, makeCtx(child.id, ops, "call-b"))
      yield* settle

      expect(count).toBe(2)
    }),
  )

  it.instance("does nothing when the session has no parent", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const alone = yield* sessions.create({ title: "alone" })
      const tool = yield* ReportToParentTool
      const def = yield* tool.init()

      let count = 0
      const ops = stubOps(() => count++)

      const result = yield* def.execute({ message: "誰にも届かない" }, makeCtx(alone.id, ops, "call-x"))
      yield* settle

      expect(count).toBe(0)
      expect(result.title).toBe("No parent")
    }),
  )

  it.instance("does not fail the child when sending the report fails", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const parent = yield* sessions.create({ title: "parent" })
      const child = yield* sessions.create({ parentID: parent.id, title: "child" })
      const tool = yield* ReportToParentTool
      const def = yield* tool.init()

      // prompt がわざと失敗する、にせものの promptOps
      let called = 0
      const ops: TaskPromptOps = {
        cancel: () => Effect.void,
        resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
        prompt: () =>
          Effect.suspend(() => {
            called++
            return Effect.die(new Error("prompt failed"))
          }),
      }

      const result = yield* def.execute({ message: "失敗しても大丈夫" }, makeCtx(child.id, ops, "call-fail"))
      yield* settle

      // 送信は試みられた
      expect(called).toBe(1)
      // それでも子のツールは失敗せず、ふつうに終わる
      expect(result.title).toBe("Reported to parent")
    }),
  )
})