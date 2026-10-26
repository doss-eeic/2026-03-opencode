import z from "zod"
import { createHash } from "node:crypto"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Effect, Option, Schema } from "effect"
import { Tool } from "./tool"
import { ScheduleRegistration } from "@/schedule/registration"

const Parameters = Schema.declare<ScheduleRegistration.CronInput>(
  (input): input is ScheduleRegistration.CronInput => ScheduleRegistration.CronInput.safeParse(input).success,
)

export const CronTool = Tool.define(
  "cron",
  Effect.gen(function* () {
    const registrations = yield* ScheduleRegistration.Service
    return {
      description:
        "Manage existing recurring message registrations for the persistent coordinator. Use cron_create to create a schedule. Actions: list, get, update, delete. List needs only action. Get requires the returned schedule id; update/delete require id and revision; update also requires patch. Read before update/delete and use the returned revision. Change enabled to pause/resume. Legacy create calls are accepted with sessionID, text and recurrenceRules; an omitted id is generated automatically. Do not claim a schedule was created until a successful tool result returns its record. Never use shell or file tools to bypass this tool's restrictions.",
      parameters: Parameters,
      formatValidationError: (error) => formatValidationError(ScheduleRegistration.CronInput, error),
      jsonSchema: z.toJSONSchema(ScheduleRegistration.ToolInput, { target: "draft-7", io: "input" }) as JSONSchema7,
      execute: (input: ScheduleRegistration.CronInput, ctx: Tool.Context) => execute(input, ctx, registrations),
    }
  }),
)

export const CronCreateTool = Tool.define(
  "cron_create",
  Effect.gen(function* () {
    const registrations = yield* ScheduleRegistration.Service
    return {
      description:
        "Create a recurring message schedule from this persistent coordinator to an existing direct child session. First use task with background=true to create the child if needed; use its returned task ID as sessionID. Required: sessionID, text, recurrenceRules. The schedule id is generated automatically; never ask the user for an internal ID. Each rule needs a local dtstart (YYYY-MM-DDTHH:mm:00), an IANA timezone, and an RRULE such as FREQ=DAILY;BYHOUR=7;BYMINUTE=0;BYSECOND=0. Ask if the time or timezone is ambiguous. Enabled defaults to true. New schedules start at the next occurrence and are checked every minute; missed or failed sends are not retried. Only confirm registration after a successful result returns the saved record. Use cron to list, inspect, update, pause, resume or delete that record. Do not delegate schedule registration to the child.",
      parameters: Schema.declare<z.infer<typeof ScheduleRegistration.CreateInput>>(
        (input): input is z.infer<typeof ScheduleRegistration.CreateInput> =>
          ScheduleRegistration.CreateInput.safeParse(input).success,
      ),
      jsonSchema: z.toJSONSchema(ScheduleRegistration.CreateInput, { target: "draft-7", io: "input" }) as JSONSchema7,
      formatValidationError: (error) => formatValidationError(ScheduleRegistration.CreateInput, error),
      execute: (input: z.infer<typeof ScheduleRegistration.CreateInput>, ctx: Tool.Context) =>
        execute({ ...input, action: "create" }, ctx, registrations),
    }
  }),
)

function execute(
  input: ScheduleRegistration.CronInput,
  ctx: Tool.Context,
  registrations: ScheduleRegistration.Interface,
) {
  return Effect.gen(function* () {
    yield* ctx.ask({
      permission: "cron",
      patterns: [input.action],
      always: ["*"],
      metadata: { action: input.action },
    })
    // A retry of the same tool call must not create a second schedule.
    const normalized =
      input.action === "create"
        ? {
            ...input,
            id:
              input.id ??
              `cron-${createHash("sha256")
                .update(JSON.stringify([ctx.sessionID, ctx.messageID, ctx.callID ?? input]))
                .digest("hex")
                .slice(0, 24)}`,
          }
        : input
    const records = yield* registrations.execute(ctx.sessionID, ScheduleRegistration.Input.parse(normalized))
    return {
      title: `Schedule ${input.action}`,
      output: JSON.stringify({ action: input.action, records }, null, 2),
      metadata: { action: input.action, count: records.length },
    }
  }).pipe(Effect.orDie)
}

function formatValidationError(schema: z.ZodType, error: unknown) {
  const actual = Schema.isSchemaError(error) && error.issue._tag === "InvalidType" ? error.issue.actual : Option.none()
  const result = Option.isSome(actual) ? schema.safeParse(actual.value) : undefined
  return result && !result.success ? z.prettifyError(result.error) : String(error)
}
