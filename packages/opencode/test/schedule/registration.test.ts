import { afterEach, expect } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { Effect, Exit } from "effect"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { ScheduleRegistration } from "@/schedule/registration"
import { ToolRegistry } from "@/tool/registry"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { MessageID, SessionID } from "@/session/schema"
import { Tool } from "@/tool/tool"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionProjector.node,
      ScheduleRegistration.node,
      Session.node,
      FSUtil.node,
      ToolRegistry.node,
      Agent.node,
    ]),
  ),
)
afterEach(disposeAllInstances)

const seed = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  const owner = yield* sessions.create({ title: "Persistent coordinator" })
  yield* sessions.setMetadata({
    sessionID: owner.id,
    metadata: {
      [ScheduleRegistration.OwnerKey]: owner.id,
      [ScheduleRegistration.BaseURLKey]: "http://127.0.0.1:4096",
      [ScheduleRegistration.TimezoneKey]: "Asia/Tokyo",
    },
  })
  const child = yield* sessions.create({ title: "Weather", parentID: owner.id })
  const input = {
    action: "create" as const,
    id: "daily-weather",
    name: "毎朝の天気",
    enabled: true,
    sessionID: child.id,
    text: "雨が降るなら教えて",
    recurrenceRules: [
      { dtstart: "2026-10-20T07:00:00", timezone: "Asia/Tokyo", rrule: "FREQ=DAILY;BYHOUR=7;BYMINUTE=0;BYSECOND=0" },
    ],
  }
  const file = path.join(
    Global.Path.data,
    "schedule-configs",
    createHash("sha256").update(owner.id).digest("hex") + ".json",
  )
  const fs = yield* FSUtil.Service
  yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore))
  return { owner, child, input, file }
})

it.instance("persists CRUD, pauses/resumes with a stable ID, and never dispatches a message", () =>
  Effect.gen(function* () {
    const { owner, child, input, file } = yield* seed()
    const service = yield* ScheduleRegistration.Service
    const fs = yield* FSUtil.Service
    const sessions = yield* Session.Service
    const [created] = yield* service.execute(owner.id, input)
    expect(created?.revision).toBe(1)
    expect(created?.baseURL).toBe("http://127.0.0.1:4096")
    expect(yield* fs.readJson(file)).toEqual([created])
    expect(yield* service.execute(owner.id, { action: "list" })).toEqual([created])
    expect(yield* service.execute(owner.id, { action: "get", id: input.id })).toEqual([created])
    const [paused] = yield* service.execute(owner.id, {
      action: "update",
      id: input.id,
      revision: 1,
      patch: { enabled: false },
    })
    expect(paused?.enabled).toBe(false)
    expect(paused?.revision).toBe(2)
    const [resumed] = yield* service.execute(owner.id, {
      action: "update",
      id: input.id,
      revision: 2,
      patch: { enabled: true, text: "天気を報告して" },
    })
    expect(resumed?.id).toBe(created?.id)
    expect(created?.id).toBe(`${owner.id}:${input.id}`)
    expect(resumed?.revision).toBe(3)
    expect(yield* sessions.messages({ sessionID: child.id })).toEqual([])
    yield* service.execute(owner.id, { action: "delete", id: input.id, revision: 3 })
    expect(yield* fs.readJson(file)).toEqual([])
  }),
)

it.instance("rejects duplicate creates and stale mutations without overwriting data", () =>
  Effect.gen(function* () {
    const { owner, input } = yield* seed()
    const service = yield* ScheduleRegistration.Service
    yield* service.execute(owner.id, input)
    expect(Exit.isFailure(yield* service.execute(owner.id, input).pipe(Effect.exit))).toBe(true)
    const mutations: ScheduleRegistration.Input[] = [
      { action: "update", id: input.id, revision: 4, patch: { text: "wrong" } },
      { action: "delete", id: input.id, revision: 4 },
    ]
    for (const mutation of mutations)
      expect(Exit.isFailure(yield* service.execute(owner.id, mutation).pipe(Effect.exit))).toBe(true)
    const outcomes = yield* Effect.all(
      ["one", "two"].map((text) =>
        service
          .execute(owner.id, {
            action: "update",
            id: input.id,
            revision: 1,
            patch: { text },
          })
          .pipe(Effect.exit),
      ),
      { concurrency: "unbounded" },
    )
    expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1)
    expect((yield* service.execute(owner.id, { action: "get", id: input.id }))[0]?.revision).toBe(2)
  }),
)

it.instance("hides cron from ordinary sessions, children, forks, and calls with no session", () =>
  Effect.gen(function* () {
    const { owner, child } = yield* seed()
    const sessions = yield* Session.Service
    const ordinary = yield* sessions.create({ title: "Ordinary" })
    const fork = yield* sessions.fork({ sessionID: owner.id })
    const agents = yield* Agent.Service
    const agent = yield* agents.get("build")
    const registry = yield* ToolRegistry.Service
    const service = yield* ScheduleRegistration.Service
    for (const sessionID of [owner.id, ordinary.id, child.id, fork.id, undefined]) {
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.make("test"),
        modelID: ModelV2.ID.make("test"),
        agent,
        sessionID,
      })
      expect(tools.some((tool) => tool.id === "cron")).toBe(sessionID === owner.id)
      expect(tools.some((tool) => tool.id === "cron_create")).toBe(sessionID === owner.id)
      if (sessionID === owner.id) {
        const schema = tools.find((tool) => tool.id === "cron")?.jsonSchema
        expect(schema?.type).toBe("object")
        expect(schema?.required).toEqual(["action"])
        const create = tools.find((tool) => tool.id === "cron_create")?.jsonSchema
        expect(create?.type).toBe("object")
        expect(create?.required).toEqual(["sessionID", "text", "recurrenceRules"])
        expect(create?.properties).not.toHaveProperty("id")
        expect(create?.properties).not.toHaveProperty("action")
      }
      if (sessionID && sessionID !== owner.id)
        expect(Exit.isFailure(yield* service.execute(sessionID, { action: "list" }).pipe(Effect.exit))).toBe(true)
    }
  }),
)

function context(sessionID: SessionID): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.ascending(),
    callID: "call-create-schedule",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (input) => {
      expect(input.permission).toBe("cron")
      expect(input.patterns).toEqual(["create"])
      return Effect.void
    },
  }
}

it.instance("creates without a model-supplied ID and prevents duplicate same-call retries", () =>
  Effect.gen(function* () {
    const { owner, child, input, file } = yield* seed()
    const agents = yield* Agent.Service
    const registry = yield* ToolRegistry.Service
    const agent = yield* agents.get("build")
    const tools = yield* registry.tools({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("test"),
      agent,
      sessionID: owner.id,
    })
    const tool = tools.find((tool) => tool.id === "cron_create")!
    const args = { sessionID: child.id, text: input.text, recurrenceRules: input.recurrenceRules }
    const ctx = context(owner.id)
    const result = yield* tool.execute(args, ctx)
    const created = JSON.parse(result.output).records[0]
    expect(created.id).toMatch(new RegExp(`^${owner.id}:cron-[a-f0-9]{24}$`))
    expect(created.enabled).toBe(true)
    expect(created.sessionID).toBe(child.id)
    const fs = yield* FSUtil.Service
    expect(yield* fs.readJson(file)).toEqual([created])
    expect(Exit.isFailure(yield* tool.execute(args, ctx).pipe(Effect.exit))).toBe(true)
    expect(Exit.isFailure(yield* tool.execute({ ...args, text: "changed" }, ctx).pipe(Effect.exit))).toBe(true)
    expect(yield* fs.readJson(file)).toEqual([created])
  }),
)

it.instance("accepts legacy cron.create without an ID but rejects missing target fields", () =>
  Effect.gen(function* () {
    const { owner, child, input } = yield* seed()
    const agents = yield* Agent.Service
    const registry = yield* ToolRegistry.Service
    const tools = yield* registry.tools({
      providerID: ProviderV2.ID.make("test"),
      modelID: ModelV2.ID.make("test"),
      agent: yield* agents.get("build"),
      sessionID: owner.id,
    })
    const legacy = tools.find((tool) => tool.id === "cron")!
    const create = tools.find((tool) => tool.id === "cron_create")!
    const args = { sessionID: child.id, text: input.text, recurrenceRules: input.recurrenceRules }
    for (const field of ["sessionID", "text", "recurrenceRules"]) {
      const invalid = Object.fromEntries(Object.entries(args).filter(([key]) => key !== field))
      const ctx = { ...context(owner.id), ask: () => Effect.die("invalid calls must not request permission") }
      const result = yield* create.execute(invalid, ctx).pipe(Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
    }
    const result = yield* legacy.execute({ ...args, action: "create" }, context(owner.id))
    const created = JSON.parse(result.output).records[0]
    expect(created.id).toMatch(new RegExp(`^${owner.id}:cron-`))
    expect(created.sessionID).toBe(child.id)
    const service = yield* ScheduleRegistration.Service
    expect(yield* service.execute(owner.id, { action: "list" })).toHaveLength(1)
  }),
)

it.instance("rejects foreign, nested, archived, and root targets and isolates owner data", () =>
  Effect.gen(function* () {
    const { owner, child, input } = yield* seed()
    const sessions = yield* Session.Service
    const service = yield* ScheduleRegistration.Service
    const other = yield* seed()
    const foreign = yield* sessions.create({ title: "Foreign", parentID: other.owner.id })
    const nested = yield* sessions.create({ title: "Nested", parentID: child.id })
    yield* sessions.setArchived({ sessionID: child.id, time: Date.now() })
    for (const target of [foreign, nested, child, owner]) {
      expect(
        Exit.isFailure(yield* service.execute(owner.id, { ...input, sessionID: target.id }).pipe(Effect.exit)),
      ).toBe(true)
    }
    yield* service.execute(other.owner.id, other.input)
    expect(yield* service.execute(owner.id, { action: "list" })).toEqual([])
    expect(yield* service.execute(other.owner.id, { action: "list" })).toHaveLength(1)
  }),
)

it.instance("refuses to overwrite corrupt saved registrations", () =>
  Effect.gen(function* () {
    const { owner, input, file } = yield* seed()
    const fs = yield* FSUtil.Service
    const service = yield* ScheduleRegistration.Service
    yield* fs.makeDirectory(path.dirname(file), { recursive: true })
    yield* fs.writeFileString(file, '[{"broken":true}]')
    expect(Exit.isFailure(yield* service.execute(owner.id, input).pipe(Effect.exit))).toBe(true)
    expect(yield* fs.readFileString(file)).toBe('[{"broken":true}]')
  }),
)

it.instance("can pause and remove a registration after its child is removed", () =>
  Effect.gen(function* () {
    const { owner, child, input } = yield* seed()
    const service = yield* ScheduleRegistration.Service
    const sessions = yield* Session.Service
    yield* service.execute(owner.id, input)
    yield* sessions.remove(child.id)
    const [paused] = yield* service.execute(owner.id, {
      action: "update",
      id: input.id,
      revision: 1,
      patch: { enabled: false },
    })
    expect(paused?.enabled).toBe(false)
    expect(
      Exit.isFailure(
        yield* service
          .execute(owner.id, { action: "update", id: input.id, revision: 2, patch: { enabled: true } })
          .pipe(Effect.exit),
      ),
    ).toBe(true)
    yield* service.execute(owner.id, { action: "delete", id: input.id, revision: 2 })
    expect(yield* service.execute(owner.id, { action: "list" })).toEqual([])
  }),
)
