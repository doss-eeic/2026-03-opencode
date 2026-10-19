import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import z from "zod"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { ScheduleConfig } from "./schema"

export const OwnerKey = "opencode.schedulerOwner"
export const BaseURLKey = "opencode.schedulerBaseURL"
export const TimezoneKey = "opencode.schedulerTimezone"

export function isOwner(session: Session.Info) {
  return !session.parentID && session.time.archived === undefined && session.metadata?.[OwnerKey] === session.id
}

export const Registration = ScheduleConfig.extend({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export type Registration = z.infer<typeof Registration>

const fields = ScheduleConfig.omit({ baseURL: true, id: true })
export const Input = z.discriminatedUnion("action", [
  fields.extend({ action: z.literal("create"), id: z.string().regex(/\S/), enabled: z.boolean().default(true) }),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("get"), id: z.string().regex(/\S/) }).strict(),
  z
    .object({
      action: z.literal("update"),
      id: z.string().regex(/\S/),
      revision: z.number().int().positive(),
      patch: fields.partial().strict(),
    })
    .strict(),
  z.object({ action: z.literal("delete"), id: z.string().regex(/\S/), revision: z.number().int().positive() }).strict(),
])
export type Input = z.infer<typeof Input>

// Providers require an object at the root of a function schema. The discriminated
// union above remains the runtime validator for action-specific required fields.
export const ToolInput = fields
  .partial()
  .extend({
    action: z.enum(["create", "list", "get", "update", "delete"]),
    id: z.string().regex(/\S/).optional(),
    revision: z.number().int().positive().optional(),
    patch: fields.partial().strict().optional(),
  })
  .strict()

export class RegistrationError extends Schema.TaggedErrorClass<RegistrationError>()("ScheduleRegistrationError", {
  message: Schema.String,
}) {}

export interface Interface {
  readonly execute: (ownerID: SessionID, input: Input) => Effect.Effect<Registration[], RegistrationError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ScheduleRegistration") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const sessions = yield* Session.Service
    const lock = Semaphore.makeUnsafe(1)

    return Service.of({
      execute: Effect.fn("ScheduleRegistration.execute")(function* (ownerID, input) {
        return yield* lock
          .withPermits(1)(
            Effect.gen(function* () {
              const owner = yield* sessions.get(ownerID)
              if (!isOwner(owner))
                return yield* new RegistrationError({
                  message: "Only the persistent coordinator session can manage schedules",
                })
              const file = path.join(
                Global.Path.data,
                "schedule-configs",
                createHash("sha256").update(owner.id).digest("hex") + ".json",
              )
              const stored = yield* fs
                .readJson(file)
                .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])))
              const rows = yield* Effect.try({
                try: () => z.array(Registration).parse(stored),
                catch: () => new RegistrationError({ message: "Invalid schedule file; refusing to overwrite it" }),
              })
              if (input.action === "list") return rows
              // Keep IDs unique across persistent coordinators as well as within one file.
              const id = input.id.startsWith(`${owner.id}:`) ? input.id : `${owner.id}:${input.id}`
              const current = rows.find((row) => row.id === id)
              if (input.action === "get") {
                if (!current) return yield* new RegistrationError({ message: "Schedule not found" })
                return [current]
              }
              if (input.action === "create" && current)
                return yield* new RegistrationError({
                  message: "Schedule ID already exists; use update with its current revision",
                })
              if (input.action !== "create" && (!current || current.revision !== input.revision))
                return yield* new RegistrationError({
                  message: "Schedule not found or revision conflict; read it again before modifying",
                })
              const record =
                input.action === "delete"
                  ? undefined
                  : yield* Effect.try({
                      try: () =>
                        Registration.parse(
                          input.action === "create"
                            ? {
                                id,
                                name: input.name,
                                enabled: input.enabled,
                                sessionID: input.sessionID,
                                text: input.text,
                                recurrenceRules: input.recurrenceRules,
                                baseURL: owner.metadata?.[BaseURLKey],
                                revision: 1,
                              }
                            : { ...current, ...input.patch, revision: current!.revision + 1 },
                        ),
                      catch: () =>
                        new RegistrationError({ message: "Invalid schedule fields or missing coordinator server URL" }),
                    })
              if (
                record &&
                (input.action === "create" ||
                  (input.action === "update" && (record.enabled || input.patch.sessionID !== undefined)))
              ) {
                const target = yield* sessions.get(SessionID.make(record.sessionID))
                if (
                  target.parentID !== owner.id ||
                  target.projectID !== owner.projectID ||
                  target.directory !== owner.directory ||
                  target.time.archived !== undefined
                )
                  return yield* new RegistrationError({
                    message: "The target must be an active direct child of this coordinator in the same directory",
                  })
              }
              const updated = rows
                .filter((row) => row.id !== id)
                .concat(record ? [record] : [])
                .sort((a, b) => a.id.localeCompare(b.id))
              const temporary = `${file}.${randomUUID()}.tmp`
              yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  yield* fs.makeDirectory(path.dirname(file), { recursive: true })
                  yield* fs.writeFileString(temporary, JSON.stringify(updated, null, 2), { mode: 0o600 })
                  yield* fs.rename(temporary, file)
                }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore))),
              )
              return record ? [record] : []
            }),
          )
          .pipe(Effect.catch((error) => Effect.fail(new RegistrationError({ message: String(error) }))))
      }),
    })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [FSUtil.node, Session.node] })

export * as ScheduleRegistration from "./registration"
