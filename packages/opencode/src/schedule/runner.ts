import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { Cause, Clock, Duration, Effect, Layer, Schedule, Context } from "effect"
import path from "path"
import z from "zod"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ScheduleRegistration } from "./registration"
import type { RecurrenceRule } from "./schema"
import { sendPrompt } from "./send"
import { RRule } from "rrule"

const CONFIG_DIR = path.join(Global.Path.data, "schedule-configs")
const STATE_FILE = path.join(Global.Path.data, "schedule-state.json")

// 状態ファイルは無くなっても次の予定から始め直すだけなので、読めなければ空から始める
const State = z.record(z.string(), z.object({ revision: z.number(), nextRunAt: z.number().nullable() })).catch({})

export interface Interface {
  readonly check: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ScheduleRunner") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const check = Effect.fn("ScheduleRunner.check")(function* () {
      const now = yield* Clock.currentTimeMillis
      const files = yield* fs.readDirectory(CONFIG_DIR).pipe(
        Effect.map((all) => all.filter((name) => name.endsWith(".json"))),
        Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])),
      )

      const registrations = yield* Effect.forEach(files, (name) =>
        fs
          .readJson(path.join(CONFIG_DIR, name))
          .pipe(Effect.map((value) => z.array(ScheduleRegistration.Registration).parse(value))),
      ).pipe(Effect.map((rows) => rows.flat()))

      const state = State.parse(yield* fs.readJson(STATE_FILE).pipe(Effect.catch(() => Effect.succeed({}))))

      const results = registrations.map((registration) => {
        const saved = state[registration.id]

        // 新しく登録・変更された設定は、すぐには送らず次の予定から始める
        if (saved?.revision !== registration.revision) {
          return {
            registration,
            due: false,
            nextRunAt: registration.enabled ? nextOccurrence(registration.recurrenceRules, now) : null,
          }
        }
        const due = saved.nextRunAt !== null && saved.nextRunAt <= now
        return {
          registration,
          due,
          nextRunAt: due ? nextOccurrence(registration.recurrenceRules, now) : saved.nextRunAt,
        }
      })

      // 送信より先に nextRunAt を保存して、同じ予定を二重に送らないようにする
      yield* fs.writeFileString(
        STATE_FILE,
        JSON.stringify(
          Object.fromEntries(
            results.map((result) => [
              result.registration.id,
              { revision: result.registration.revision, nextRunAt: result.nextRunAt },
            ]),
          ),
          null,
          2,
        ),
      )

      yield* Effect.forEach(
        results.filter((result) => result.due),
        (result) =>
          Effect.tryPromise(() => sendPrompt(result.registration)).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("scheduled prompt failed", { id: result.registration.id, cause: Cause.pretty(cause) }),
            ),
          ),
        { discard: true },
      )
    }, Effect.orDie)

    yield* check().pipe(
      Effect.catchCause((cause) => Effect.logError("schedule check failed", { cause: Cause.pretty(cause) })),
      Effect.repeat(Schedule.spaced(Duration.minutes(1))),
      Effect.delay(Duration.minutes(1)),
      Effect.forkScoped,
    )

    return Service.of({ check })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [FSUtil.node] })

// 全ルールのうち now より後で最も早い予定。予定が残っていなければ null
function nextOccurrence(rules: RecurrenceRule[], now: number) {
  const times = rules.flatMap((rule) => {
    // 現地時刻を UTC とみなして計算し、最後に時差を戻す
    const offset = (time: number) =>
      Date.parse(new Date(time).toLocaleString("sv-SE", { timeZone: rule.timezone }).replace(" ", "T") + "Z") - time
    const next = new RRule({ ...RRule.parseString(rule.rrule), dtstart: new Date(rule.dtstart + "Z") }).after(
      new Date(now + offset(now)),
    )
    return next ? [next.getTime() - offset(next.getTime())] : []
  })
  return times.length ? Math.min(...times) : null
}

export * as ScheduleRunner from "./runner"
