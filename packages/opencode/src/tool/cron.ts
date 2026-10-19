import z from "zod"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import { ScheduleRegistration } from "@/schedule/registration"

const Parameters = Schema.declare<ScheduleRegistration.Input>(
  (input): input is ScheduleRegistration.Input => ScheduleRegistration.Input.safeParse(input).success,
)

export const CronTool = Tool.define(
  "cron",
  Effect.gen(function* () {
    const registrations = yield* ScheduleRegistration.Service
    return {
      description:
        "Manage recurring message registrations for the persistent coordinator. Actions: create, list, get, update, delete. For a recurring request, use task to create an appropriate child session first, then register its task_id as sessionID. Create requires id, sessionID, text and recurrenceRules; enabled defaults to true. Get requires id; update/delete require id and revision; update also requires patch. List needs only action. Use a stable descriptive id. Create qualifies it with the coordinator session ID; use the returned id for subsequent operations. Include the local dtstart, IANA timezone, and RFC 5545 RRULE value. Ask the user if the time or timezone is ambiguous. Read before update/delete and use the returned revision. Change enabled to pause/resume. These are saved registrations only: the time-based dispatcher is not implemented, so never claim that automatic execution has started. Never use shell or file tools to bypass this tool's restrictions.",
      parameters: Parameters,
      jsonSchema: z.toJSONSchema(ScheduleRegistration.ToolInput, { target: "draft-7", io: "input" }) as JSONSchema7,
      execute: (input: ScheduleRegistration.Input, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "cron",
            patterns: [input.action],
            always: ["*"],
            metadata: { action: input.action },
          })
          const records = yield* registrations.execute(ctx.sessionID, ScheduleRegistration.Input.parse(input))
          return {
            title: `Schedule ${input.action}`,
            output: JSON.stringify({ action: input.action, records, automaticExecution: "not_implemented" }, null, 2),
            metadata: { action: input.action, count: records.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
