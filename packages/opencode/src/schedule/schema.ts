import z from "zod"
import { RRule } from "rrule"

const id = z.string().regex(/\S/, "ID must not be blank")
const text = z.string().regex(/\S/, "text must not be blank")
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const SendConfig = z
  .object({
    baseURL: z.url(),
    sessionID: id,
    text,
  })
  .strict()

export type SendConfig = z.infer<typeof SendConfig>

const RRULE_FORMAT =
  'Use an RFC 5545 RRULE value, for example "FREQ=DAILY;BYHOUR=7;BYMINUTE=0;BYSECOND=0" or "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=30;BYSECOND=0"'

export const RecurrenceRule = z
  .object({
    dtstart: z.iso
      .datetime({ local: true, precision: 0 })
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/, "Use local YYYY-MM-DDTHH:mm:00 without an offset"),
    timezone: z.string().refine(isTimeZone, "Use an IANA time zone, for example Asia/Tokyo"),
    rrule: z.string().superRefine((value, ctx) => {
      const problem = rruleProblem(value)
      if (problem) ctx.addIssue({ code: "custom", message: `${problem}. ${RRULE_FORMAT}` })
    }),
  })
  .strict()

export type RecurrenceRule = z.infer<typeof RecurrenceRule>

const schedule = z
  .object({
    id,
    name: z.string().optional(),
    revision,
    enabled: z.boolean(),
    sessionID: id,
    text,
    recurrenceRules: z.array(RecurrenceRule).min(1),
    nextRunAt: timestamp.nullable(),
  })
  .strict()

export const Schedule = schedule.refine((value) => value.enabled || value.nextRunAt === null, {
  message: "A disabled schedule must have nextRunAt: null",
  path: ["nextRunAt"],
})

export type Schedule = z.infer<typeof Schedule>

export const ScheduleConfig = schedule
  .omit({ revision: true, nextRunAt: true })
  .extend({ baseURL: SendConfig.shape.baseURL })

export type ScheduleConfig = z.infer<typeof ScheduleConfig>

export const RunStatus = z.enum(["pending", "dispatching", "submitted", "failed", "unknown", "skipped"])

export type RunStatus = z.infer<typeof RunStatus>

export const Run = z
  .object({
    id,
    scheduleID: id,
    scheduleRevision: revision,
    scheduledAt: timestamp,
    // Snapshot the target and message so later edits cannot change an admitted run.
    baseURL: SendConfig.shape.baseURL,
    sessionID: id,
    text,
    status: RunStatus,
  })
  .strict()

export type Run = z.infer<typeof Run>

function isTimeZone(value: string) {
  if (!value || /^[+-]/.test(value)) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value })
    return true
  } catch {
    return false
  }
}

function rruleProblem(value: string) {
  if (!/\S/.test(value)) return "rrule must not be blank"
  const options = parseRRule(value)
  if (!options) return `Could not parse rrule "${value}"`
  if (options.freq === undefined || options.freq === null) return "rrule must include FREQ"
}

function parseRRule(value: string) {
  try {
    const options = RRule.parseString(value)
    new RRule({ ...options, dtstart: new Date(0) })
    return options
  } catch {
    return undefined
  }
}
