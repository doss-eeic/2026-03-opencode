import { describe, expect, test } from "bun:test"
import { RecurrenceRule, Run, RunStatus, Schedule, ScheduleConfig, SendConfig } from "@/schedule/schema"
import example from "../../examples/schedules/daily-check.json"

const recurrence = example.recurrenceRules[0]
const schedule = {
  id: example.id,
  name: example.name,
  revision: 1,
  enabled: true,
  sessionID: example.sessionID,
  text: example.text,
  recurrenceRules: example.recurrenceRules,
  nextRunAt: Date.UTC(2026, 9, 19, 22),
}

describe("schedule input contract", () => {
  test("the documented file is a valid config, not runtime state or a one-shot config", () => {
    expect(ScheduleConfig.parse(example)).toEqual(example)
    expect(Schedule.safeParse(example).success).toBe(false)
    expect(SendConfig.safeParse(example).success).toBe(false)
  })

  test("keeps the existing three-field send contract", () => {
    const input = { baseURL: example.baseURL, sessionID: example.sessionID, text: example.text }
    expect(SendConfig.parse(input)).toEqual(input)
    expect(SendConfig.safeParse({ ...input, sessionID: " " }).success).toBe(false)
    expect(SendConfig.safeParse({ ...input, text: "\n\t" }).success).toBe(false)
  })

  test.each(["revision", "nextRunAt", "directory"])("rejects managed or unknown config field: %s", (field) => {
    expect(ScheduleConfig.safeParse({ ...example, [field]: 1 }).success).toBe(false)
  })

  test.each([{ rules: [] }, { rules: undefined }])("requires one or more recurrence rules: %j", (input) => {
    expect(ScheduleConfig.safeParse({ ...example, recurrenceRules: input.rules }).success).toBe(false)
  })

  test.each([
    "2026-10-20T07:00:00Z",
    "2026-10-20T07:00:00+09:00",
    "2026-10-20T07:00:01",
    "2026-10-20T07:00",
    "2026-02-29T07:00:00",
    "2026-04-31T07:00:00",
    "2026-10-20T25:00:00",
  ])("rejects non-local, non-minute, or invalid dtstart: %s", (dtstart) => {
    expect(RecurrenceRule.safeParse({ ...recurrence, dtstart }).success).toBe(false)
  })

  test("accepts local leap-day timestamps", () => {
    expect(RecurrenceRule.safeParse({ ...recurrence, dtstart: "2028-02-29T07:00:00" }).success).toBe(true)
  })

  test.each(["", "Mars/Olympus_Mons", "+09:00"])("rejects invalid timezone: %s", (timezone) => {
    expect(RecurrenceRule.safeParse({ ...recurrence, timezone }).success).toBe(false)
  })

  test.each(["Asia/Tokyo", "America/New_York", "UTC"])("accepts a named timezone: %s", (timezone) => {
    expect(RecurrenceRule.safeParse({ ...recurrence, timezone }).success).toBe(true)
  })

  test("rejects blank RRULEs without pretending to implement a recurrence engine", () => {
    expect(RecurrenceRule.safeParse({ ...recurrence, rrule: " \n" }).success).toBe(false)
  })
})

describe("schedule state contract", () => {
  test("keeps runtime state out of the hand-written config", () => {
    expect(Schedule.parse(schedule)).toEqual(schedule)
    expect(Schedule.safeParse({ ...schedule, baseURL: example.baseURL }).success).toBe(false)
  })

  test("requires null for disabled schedules and permits exhausted schedules", () => {
    expect(Schedule.safeParse({ ...schedule, enabled: false }).success).toBe(false)
    expect(Schedule.safeParse({ ...schedule, enabled: false, nextRunAt: null }).success).toBe(true)
    expect(Schedule.safeParse({ ...schedule, nextRunAt: null }).success).toBe(true)
  })

  test.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision: %s", (revision) => {
    expect(Schedule.safeParse({ ...schedule, revision }).success).toBe(false)
  })

  test.each([-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid UTC milliseconds: %s", (nextRunAt) => {
    expect(Schedule.safeParse({ ...schedule, nextRunAt }).success).toBe(false)
  })
})

describe("scheduled run contract", () => {
  const run = {
    id: "run-1",
    scheduleID: example.id,
    scheduleRevision: 1,
    scheduledAt: schedule.nextRunAt,
    baseURL: example.baseURL,
    sessionID: example.sessionID,
    text: example.text,
  }

  test.each(RunStatus.options)("records the dispatch state %s", (status) => {
    expect(Run.parse({ ...run, status })).toEqual({ ...run, status })
  })

  test("requires a revision and target snapshot and rejects execution-complete status", () => {
    expect(Run.safeParse({ ...run, scheduleRevision: undefined, status: "pending" }).success).toBe(false)
    expect(Run.safeParse({ ...run, baseURL: undefined, status: "pending" }).success).toBe(false)
    expect(Run.safeParse({ ...run, status: "completed" }).success).toBe(false)
    expect(Run.safeParse({ ...run, scheduledAt: -1, status: "pending" }).success).toBe(false)
  })
})
