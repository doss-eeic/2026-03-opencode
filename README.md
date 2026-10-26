<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

## This fork: persistent chat, background work, and schedules

This repository adds a persistent coordinator chat to OpenCode. The instructions below run this fork from source. As of 2026-10-26, PRs [#1](https://github.com/doss-eeic/2026-03-opencode/pull/1)–[#8](https://github.com/doss-eeic/2026-03-opencode/pull/8) are all merged into `main`.

### Start the chat

Use the Bun version declared in [`package.json`](package.json) (`bun@1.3.14`). From the repository root:

```sh
bun install --frozen-lockfile
```

Start the backend in terminal A:

```sh
bun run dev:bot --port 4096
```

This enables background subagents and loads the coordinator instructions in [`background-chat.md`](packages/opencode/examples/background-chat.md). The backend also checks registered schedules every minute. Keep this process running for background jobs and scheduled messages.

Start the frontend in terminal B, also from the repository root:

```sh
bun run dev:web -- --host 127.0.0.1 --port 4444
```

Open [http://127.0.0.1:4444](http://127.0.0.1:4444). Configure a model provider through **Settings**, or set its environment variable, such as `OPENAI_API_KEY`, before starting the backend. The browser automatically creates and remembers one coordinator conversation per browser origin, backend, and working directory. The Akamon Cat theme is enabled by default; model selection, attachments, send/stop, and permission/question prompts remain available.

### Which terminal command does what?

All commands in this table run from the repository root.

| Command                                                                          | What it does                                                                                                                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run dev:bot --port 4096`                                                    | Starts the backend with the background-task flag and coordinator instructions. Use this with the single-session frontend for background delegation and chat-managed schedules.     |
| `bun run dev:web -- --host 127.0.0.1 --port 4444`                                | Opens the local frontend at port 4444, targeting backend port 4096 by default. Includes the persistent conversation and cat theme.                                                 |
| `VITE_OPENCODE_UI_MODE=full bun run dev:web -- --host 127.0.0.1 --port 4444`     | Selects the original project/session UI instead of the single-session chat. It does not mark new sessions as schedule coordinators.                                                |
| `VITE_OPENCODE_SERVER_PORT=4097 bun run dev:web -- --host 127.0.0.1 --port 4445` | Starts another frontend targeting a backend on port 4097. Start that backend with `bun run dev:bot --port 4097`; a different frontend origin uses its own remembered conversation. |
| `bun run dev serve --hostname 127.0.0.1 --port 4096`                             | Starts the standard backend without the `dev:bot` background flag or additional coordinator instructions.                                                                          |
| `bun run dev`                                                                    | Opens the standard terminal UI.                                                                                                                                                    |
| `bun run dev auth login`                                                         | Opens provider authentication in the terminal.                                                                                                                                     |
| `bun run dev --help` / `bun run dev serve --help`                                | Lists CLI commands / backend options.                                                                                                                                              |

Use free ports when another instance is already running. For schedules, use one backend process per OpenCode data directory: the current scheduler does not coordinate multiple processes sharing the same registrations.

### What can I ask in the chat?

Type ordinary requests into the persistent chat. The tool names below are tools the assistant calls, **not shell commands or slash commands**. Tool selection depends on the selected model, its instructions, and permissions.

| Goal                               | Example chat request                                                                           | Tool used by the assistant                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delegate work and receive progress | “Investigate this project's structure in the background. Report progress and the result here.” | `task` with `background: true`; the child uses `report_to_parent`, and completion is reported automatically.                                                                    |
| Continue an existing task          | “Continue the task you started earlier and check its tests.”                                   | `task` with the previous `task_id`, reusing the child session.                                                                                                                  |
| Create a recurring task            | “毎朝7時、Asia/Tokyoで、このプロジェクトの変更を確認して、結果をこのチャットへ報告して。”      | `task` prepares a child if needed; the coordinator calls `cron_create` with the child's `sessionID`, `text`, and `recurrenceRules`. The schedule ID is generated automatically. |
| List or inspect schedules          | “Show my registered schedules and the details of the morning check.”                           | `cron` with `action: "list"` or `action: "get"`.                                                                                                                                |
| Change a schedule                  | “Move the morning check to 08:00 Asia/Tokyo.”                                                  | `cron` with `action: "update"`, the current `revision`, and a `patch`.                                                                                                          |
| Pause or resume                    | “Pause the morning check.” / “Resume it.”                                                      | `cron` update with `patch.enabled: false` / `true`; the same schedule ID is retained.                                                                                           |
| Delete a schedule                  | “Delete the morning check.”                                                                    | `cron` with `action: "delete"`, its ID, and the current `revision`.                                                                                                             |

The assistant should confirm schedule creation only after a successful tool result. `cron_create` requires an existing active direct child of the coordinator in the same project and directory. Each recurrence rule contains a local `dtstart` (`YYYY-MM-DDTHH:mm:00`, without `Z` or an offset), an IANA `timezone`, and an RFC 5545 `rrule` containing `FREQ`. For example, `FREQ=DAILY;BYHOUR=7;BYMINUTE=0;BYSECOND=0` runs daily at 07:00 in that timezone. You can give the time in ordinary language; the assistant constructs these fields.

### What the implemented PRs provide

| PR                                                         | Available behavior                                                                                                           | How to use it                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/doss-eeic/2026-03-opencode/pull/1) | One persistent browser conversation, reused across reloads/tabs, with chat essentials.                                       | Start `dev:web`; single-session mode is the default.                                                       |
| [#2](https://github.com/doss-eeic/2026-03-opencode/pull/2) | Background child tasks, intermediate parent reports, and completion notifications.                                           | Start `dev:bot`, then request background work.                                                             |
| [#3](https://github.com/doss-eeic/2026-03-opencode/pull/3) | Persistent schedule registration/management and a backend runner that checks schedules every minute.                         | Use the coordinator chat; registrations are saved under the OpenCode data directory's `schedule-configs/`. |
| [#4](https://github.com/doss-eeic/2026-03-opencode/pull/4) | Akamon Cat header, assistant portraits, speech bubbles, and light/dark themes.                                               | Open the default single-session frontend; no additional switch is needed.                                  |
| [#5](https://github.com/doss-eeic/2026-03-opencode/pull/5) | Validates recurrence input, returns detailed validation errors, and asks scheduled children to report results to the parent. | Included automatically when registering and dispatching schedules.                                         |
| [#6](https://github.com/doss-eeic/2026-03-opencode/pull/6) | Preserves the parent's agent and model variant when receiving child progress reports.                                        | Included automatically in `report_to_parent`.                                                              |
| [#7](https://github.com/doss-eeic/2026-03-opencode/pull/7) | Preserves the scheduled child's agent and model variant when dispatching a message.                                          | Included automatically when a schedule fires.                                                              |
| [#8](https://github.com/doss-eeic/2026-03-opencode/pull/8) | Adds dedicated `cron_create`, generates internal schedule IDs, and accepts older `cron.create` calls without an ID.          | Ask to create a schedule; use `cron` for subsequent management.                                            |

### Current operating limits

- Schedule tools are exposed only to the persistent coordinator on the standard `packages/opencode` backend. Ordinary, child, and forked sessions cannot manage schedules. Native-only v2 servers do not support this registration path.
- New or changed schedules start at their next future occurrence, after the runner observes the registration; registration itself does not dispatch work. Checks run every minute, so execution is not exact to the second.
- A missed interval is not replayed once per missed occurrence. Dispatch state is advanced before sending; failed or uncertain sends are not automatically retried. Request acceptance is separate from the child's completion and its report reaching the parent.
- Registrations and scheduler state persist on disk. Running background jobs and progress-report deduplication are process-local; recovery of those jobs, cross-process coordination, and exactly-once delivery are not implemented.

Current contracts: [`cron` / `cron_create`](packages/opencode/src/tool/cron.ts), [schedule validation](packages/opencode/src/schedule/schema.ts), [runner](packages/opencode/src/schedule/runner.ts), [scheduled dispatch](packages/opencode/src/schedule/send.ts), and [parent reporting](packages/opencode/src/tool/report-to-parent.ts). The [single-session guide](packages/app/docs/single-session.md) and [theme screenshots](packages/app/docs/akamon-chat.md) provide further UI details. Older PR descriptions and design notes may describe the state before later fixes.

### Useful verification commands

Run these from the indicated package directory; the repository root intentionally rejects `bun test`.

```sh
# From packages/opencode: schedule contracts, dispatch, task delegation, and reporting
bun test test/schedule test/tool/task.test.ts test/tool/report-to-parent.test.ts
bun test test/session/prompt.test.ts -t 'background demo delivers'
bun test test/session/prompt.test.ts -t 'persistent chat request invokes cron_create'
bun typecheck

# From packages/app: persistent-session unit tests, browser flow, and build
bun test --conditions=solid --preload ./happydom.ts src/utils/single-session.test.ts src/context/command.test.ts
bun typecheck
bun run typecheck:e2e
bunx playwright install chromium
PLAYWRIGHT_PORT=4451 bun run test:e2e:single-session --workers=1
bun run build
```

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
