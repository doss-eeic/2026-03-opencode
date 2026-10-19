# Single-session web chat

The browser entrypoint opens a minimal chat and creates its conversation automatically in the backend working directory. It remembers that session per browser origin/profile, backend URL, and working directory. Reloading and opening another tab reuse it. A scoped Web Lock serializes creation, and storage is read inside the lock.

Messages, streaming, send/stop, model selection, settings, attachments, and permission/question prompts use the existing implementation. Project navigation, session tabs, session creation/switching commands, file/review panels, and terminals are hidden. Existing conversations are not adopted or deleted. Confirmed deleted or archived sessions are replaced; connection and authorization failures retain the stored identity and show a retry action (the localized “Continue” button).

## Interface and compatibility

The browser entrypoint wraps `AppInterface` in `SingleSessionContext` (default `false`); desktop callers and the TUI keep their current behavior. `VITE_OPENCODE_UI_MODE=full` explicitly selects the original browser UI. The normal Playwright configuration uses full mode; the separate single-session configuration covers the browser default.

Both legacy and current backend protocols use their existing session APIs. Current servers resolve the working folder through `location.get`; legacy servers use `path.get`. No server API, schema, or migration changes are included. The remembered pointer is a `localStorage` entry keyed by the existing server/workspace storage name. Clearing browser storage starts another conversation without deleting the old one. Web Locks require localhost or HTTPS in a supporting browser.

## Run locally

From the repository root, install dependencies with `bun install --frozen-lockfile`. Use separate terminals:

```sh
cd packages/opencode
bun run ./src/index.ts serve --port 4096
```

```sh
cd packages/app
bun dev -- --port 4444 --host 127.0.0.1
```

Open http://127.0.0.1:4444. With the backend command above, the working directory is `packages/opencode`. To work at the repository root instead, launch `bun run packages/opencode/src/index.ts serve --port 4096` from that root. Do not restart an already-running server to change directories; choose the intended directory when launching a new instance on a free port and configure the frontend server port accordingly.

## Verification (2026-10-15)

- App and E2E typechecking passed.
- Focused unit tests: 12 passed. Browser-component tests: 41 passed.
- Single-session browser scenarios: 11 passed, covering startup/reopen, concurrent tabs, legacy links, deletion/archive recovery, authorization retry, directory isolation, model selection, responsive layout, legacy servers, streaming/stop, and permission/question responses.
- Full-UI regression checks: 4 passed (permission/question docks, caret restoration, terminal hiding).
- Production build passed as part of the benchmark.
- Local backend and frontend started successfully; an actual browser reload retained the same session. Desktop and mobile layouts were inspected. Provider execution was exercised with deterministic browser fixtures, not a live paid model.
- The broad unit suite reported 729 passes and one failure before the final storage test was added. The failure is the unchanged `desktop-native.test.ts` assertion for `pa-PK` (expected `pa`, received `en`) under Bun 1.4.2; it also reproduces when that existing test file runs alone.

Run checks from `packages/app`, not the repository root:

```sh
bun typecheck
bun run typecheck:e2e
bun test --conditions=solid --preload ./happydom.ts src/utils/single-session.test.ts src/context/command.test.ts
bun run test:browser
PLAYWRIGHT_PORT=4451 bun run test:e2e:single-session --workers=1
PLAYWRIGHT_PORT=4452 bunx playwright test e2e/regression/session-request-docks.spec.ts e2e/regression/terminal-hidden.spec.ts --workers=1
```

## Production benchmark

The original full UI and the minimal UI were measured with the same Chromium workload: 40 historical turns, 80 streamed deltas, event batch 1, CPU throttle 1. This is a reduced local diagnostic workload, not the suite's default stress profile.

| Metric                       | Original full UI |   Minimal UI |
| ---------------------------- | ---------------: | -----------: |
| Completion observed          |     20,115.10 ms | 20,854.50 ms |
| Initial content observed     |        359.09 ms |    395.09 ms |
| Long tasks                   |                0 |            0 |
| Timeline/Markdown remounts   |            0 / 0 |        0 / 0 |
| Blank samples / bottom drift |            0 / 0 |        0 / 0 |

All 80 deltas were delivered in both runs. The single-sample completion difference is approximately +3.7%; this is not enough evidence for a performance improvement or regression claim. Raw benchmark records are in `single-session-benchmark.json`.

```sh
PLAYWRIGHT_PORT=4450 VITE_OPENCODE_UI_MODE=single-session \
TIMELINE_CPU_THROTTLE=1 TIMELINE_HISTORY_TURNS=40 TIMELINE_DELTA_COUNT=80 \
bunx playwright test --config e2e/performance/playwright.config.ts \
timeline/session-timeline-benchmark.spec.ts \
-g 'streams assistant text in v2 with review pane closed'
```

## 定期実行の登録ツールとの接続（2026-10-19）

PR3では、標準サーバーへの接続時に、記憶したセッション自身を `opencode.schedulerOwner` metadataで指定し、接続先とブラウザーのタイムゾーンも保存する。準備に失敗した場合は会話を開かず、同じ保存済みIDで再試行する。フルUIでは指定しない。詳細は [`../../opencode/docs/scheduled-tasks.md`](../../opencode/docs/scheduled-tasks.md)。互換APIのないV2専用サーバーでは、このツール登録を行わず既存チャット動作を保つ。

登録CRUDと子セッション制限は標準サーバーの互換ツール実行経路に実装し、予定時刻の送信はまだ行わない。

セッションコード変更前後に、上記と同じ40履歴・80デルタ・CPU throttle 1のproduction benchmarkを測定した。初期表示は397.15→379.28 ms、完了観測は20,671.30→20,555.30 ms。いずれも80デルタ配信、long task・再マウント・空白・下端ずれは0。各1サンプルの互換性確認であり、性能改善を示すものではない。このbenchmarkはV2チャット経路を測り、v1のmetadata登録通信はブラウザー回帰テストで別途確認する。記録は [`schedule-registration-benchmark.json`](./schedule-registration-benchmark.json)。
