import { expect, test, type Page } from "@playwright/test"
import { installSseTransport } from "../utils/sse-transport"
import { currentSession, mockOpenCodeServer } from "../utils/mock-server"

const directory = "/work/single-session"
const provider = {
  all: [
    {
      id: "opencode",
      name: "OpenCode",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          limit: { context: 200000 },
          cost: { input: 0, output: 0 },
        },
      },
    },
  ],
  connected: ["opencode"],
  default: { providerID: "opencode", modelID: "test-model" },
}

function state() {
  return {
    directory,
    creates: [] as string[],
    failure: 0,
    protocol: "v2" as "v1" | "v2",
    permissions: [] as unknown[],
    questions: [] as unknown[],
    messages: [] as unknown[],
    statuses: {} as Record<string, { type: string }>,
    sessions: [] as Array<{
      id: string
      directory: string
      title: string
      projectID: string
      time: { created: number; updated: number; archived?: number }
    }>,
  }
}

async function setup(page: Page, data: ReturnType<typeof state>) {
  await mockOpenCodeServer(page, {
    protocol: data.protocol,
    directory: data.directory,
    project: { id: "proj_single", worktree: data.directory, vcs: "git", time: { created: 1, updated: 1 } },
    provider,
    sessions: data.sessions,
    pageMessages: () => ({ items: data.messages }),
    sessionStatus: data.statuses,
    permissions: () => data.permissions,
    questions: () => data.questions,
  })
  await page.route("**/*", async (route) => {
    const path = new URL(route.request().url()).pathname
    const headers = { "access-control-allow-origin": "*" }
    const location = { directory: data.directory, project: { id: "proj_single", directory: data.directory } }
    const model = {
      id: "test-model",
      modelID: "test-model",
      providerID: "opencode",
      name: "Test Model",
      capabilities: { input: ["text"], output: ["text"], tools: true },
      variants: [],
      cost: [],
      time: { released: 1700000000000 },
      status: "active",
      enabled: true,
      limit: { context: 200000, output: 8000 },
    }
    if (path === "/api/provider")
      return route.fulfill({ json: { location, data: [{ id: "opencode", name: "OpenCode" }] }, headers })
    if (path === "/api/model")
      return route.fulfill({
        json: {
          location,
          data: [model, { ...model, id: "test-alternate", modelID: "test-alternate", name: "Alternate Model" }],
        },
        headers,
      })
    if (path === "/api/model/default") return route.fulfill({ json: { location, data: model }, headers })
    if (path === "/api/location")
      return route.fulfill({
        json: { directory: data.directory, project: { id: "proj_single", directory: data.directory } },
        headers,
      })
    if (["/api/session", "/session"].includes(path) && route.request().method() === "POST") {
      const body = route.request().postDataJSON()
      if (data.protocol === "v2") expect(body.location.directory).toBe(data.directory)
      const session = {
        id: `ses_auto_${data.creates.length + 1}`,
        directory: data.directory,
        title: "Main conversation",
        projectID: "proj_single",
        agent: "build",
        model: { id: "test-model", providerID: "opencode" },
        time: { created: Date.now(), updated: Date.now() },
      }
      data.sessions.push(session)
      data.creates.push(session.id)
      return route.fulfill({ json: data.protocol === "v1" ? session : { data: currentSession(session) }, headers })
    }
    const id = path.match(/^\/api\/session\/([^/]+)$/)?.[1]
    if (id && route.request().method() === "GET") {
      if (data.failure) return route.fulfill({ status: data.failure, json: { _tag: "Unauthorized" }, headers })
      const session = data.sessions.find((item) => item.id === id)
      if (!session)
        return route.fulfill({ status: 404, json: { _tag: "SessionNotFoundError", sessionID: id }, headers })
      return route.fulfill({ json: { data: currentSession(session) }, headers })
    }
    return route.fallback()
  })
}

async function ready(page: Page, id: string) {
  await expect(page).toHaveURL(new RegExp(`/session/${id}$`))
  await expect(page.getByRole("button", { name: "Open settings", exact: true })).toBeVisible()
  await expect(page.locator('[data-component="prompt-input"][contenteditable="true"]')).toBeVisible()
}

test("automatically creates one conversation and reuses it after reload and reopening", async ({ page, context }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  expect(data.creates).toEqual(["ses_auto_1"])
  await page.reload()
  await ready(page, "ses_auto_1")
  const reopened = await context.newPage()
  await setup(reopened, data)
  await reopened.goto("/")
  await ready(reopened, "ses_auto_1")
  expect(data.creates).toEqual(["ses_auto_1"])
})

test("simultaneous tabs share one creation", async ({ page, context }) => {
  const data = state()
  const other = await context.newPage()
  await Promise.all([setup(page, data), setup(other, data)])
  await Promise.all([page.goto("/"), other.goto("/")])
  await Promise.all([ready(page, "ses_auto_1"), ready(other, "ses_auto_1")])
  expect(data.creates).toEqual(["ses_auto_1"])
})

test("redirects legacy and new-session links without adopting unrelated sessions", async ({ page }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/new-session")
  await ready(page, "ses_auto_1")
  await page.goto("/old-directory/session/ses_unrelated")
  await ready(page, "ses_auto_1")
  expect(data.creates).toEqual(["ses_auto_1"])
})

test("replaces archived and deleted sessions", async ({ page }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  data.sessions[0]!.time.archived = Date.now()
  await page.reload()
  await ready(page, "ses_auto_2")
  data.sessions.splice(1, 1)
  await page.reload()
  await ready(page, "ses_auto_3")
  expect(data.creates).toEqual(["ses_auto_1", "ses_auto_2", "ses_auto_3"])
})

test("authorization errors preserve the session and allow retry", async ({ page }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  data.failure = 401
  await page.reload()
  await expect(page.getByRole("alert")).toContainText("Request failed")
  expect(data.creates).toEqual(["ses_auto_1"])
  data.failure = 0
  await page.getByRole("button", { name: "Continue", exact: true }).click()
  await ready(page, "ses_auto_1")
  expect(data.creates).toEqual(["ses_auto_1"])
})

test("scopes the conversation to the backend working directory", async ({ page }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  data.directory = "/work/other"
  await page.reload()
  await ready(page, "ses_auto_2")
  data.directory = directory
  await page.reload()
  await ready(page, "ses_auto_1")
  expect(data.creates).toHaveLength(2)
})

test("keeps essentials while suppressing panels and navigation shortcuts on desktop and mobile", async ({ page }) => {
  const data = state()
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  const modelControl = page.locator('[data-action="prompt-model"]')
  await expect(modelControl).toBeVisible()
  await modelControl.click()
  await page.getByRole("button", { name: "Alternate Model Free", exact: true }).click()
  await expect(modelControl).toContainText("Alternate Model")
  await page.getByRole("button", { name: "Open settings", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  for (const shortcut of ["ControlOrMeta+Shift+S", "ControlOrMeta+`", "ControlOrMeta+P"]) {
    await page.keyboard.press(shortcut)
    await ready(page, "ses_auto_1")
  }
  await expect(page.locator('[data-component="terminal"]')).toHaveCount(0)
  await expect(page.locator('[data-action="home-new-session"]')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await ready(page, "ses_auto_1")
  await expect(page.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0)
  expect(data.creates).toHaveLength(1)
})

test("supports legacy backends", async ({ page }) => {
  const data = state()
  data.protocol = "v1"
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  await page.reload()
  await ready(page, "ses_auto_1")
  expect(data.creates).toHaveLength(1)
})

test("sends to the remembered session, renders streaming replies, and stops execution", async ({ page }) => {
  const data = state()
  const transport = await installSseTransport(page, {
    server: `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
  })
  await setup(page, data)
  await page.route("**/api/session/*/prompt", (route) =>
    route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }),
  )
  await page.goto("/")
  await ready(page, "ses_auto_1")
  await transport.waitForConnection()
  await expect(page.getByRole("button", { name: "Test Model", exact: true })).toBeVisible()
  const editor = page.locator('[data-component="prompt-input"][contenteditable="true"]')
  await editor.fill("Hello from the main chat")
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/session/ses_auto_1/prompt",
  )
  await page.getByRole("button", { name: "Send", exact: true }).click()
  const sent = (await request).postDataJSON()
  expect(sent.text).toBe("Hello from the main chat")
  data.messages.push({
    info: {
      id: sent.id,
      sessionID: "ses_auto_1",
      role: "user",
      agent: "build",
      model: { providerID: "opencode", modelID: "test-model" },
      time: { created: Date.now() },
    },
    parts: [{ id: "prt_single_user", type: "text", text: sent.text, sessionID: "ses_auto_1", messageID: sent.id }],
  })
  data.statuses.ses_auto_1 = { type: "busy" }
  let seq = 0
  const send = (type: string, extra = {}) =>
    transport.send({
      id: `evt_single_${++seq}`,
      type,
      created: Date.now(),
      durable: { aggregateID: "ses_auto_1", seq, version: 1 },
      location: { directory },
      data: { sessionID: "ses_auto_1", assistantMessageID: "msg_single_reply", ...extra },
    })
  await send("session.input.admitted", {
    inputID: sent.id,
    input: { id: sent.id, type: "user", data: { text: sent.text } },
  })
  await send("session.input.promoted", { inputID: sent.id })
  await send("session.execution.started")
  await send("session.step.started", { agent: "build", model: { id: "test-model", providerID: "opencode" } })
  await send("session.text.started", { ordinal: 0 })
  await send("session.text.delta", { ordinal: 0, delta: "Streaming reply" })
  await expect(page.getByText("Streaming reply", { exact: true })).toBeVisible()
  await send("session.text.delta", { ordinal: 0, delta: " arrived" })
  await expect(page.getByText("Streaming reply arrived", { exact: true })).toBeVisible()
  data.messages.push({
    info: {
      id: "msg_single_reply",
      sessionID: "ses_auto_1",
      role: "assistant",
      parentID: sent.id,
      agent: "build",
      mode: "build",
      providerID: "opencode",
      modelID: "test-model",
      path: { cwd: directory, root: directory },
      cost: 0,
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: Date.now() },
    },
    parts: [
      {
        id: "prt_single_reply",
        type: "text",
        text: "Streaming reply arrived",
        sessionID: "ses_auto_1",
        messageID: "msg_single_reply",
      },
    ],
  })
  await editor.fill("")
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible()
  const stop = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/session/ses_auto_1/interrupt",
  )
  await page.getByRole("button", { name: "Stop", exact: true }).click()
  await stop
  expect(data.creates).toHaveLength(1)
})

test("keeps permission and question responses usable", async ({ page }) => {
  const data = state()
  data.permissions = [
    {
      id: "req_permission",
      sessionID: "ses_auto_1",
      permission: "bash",
      patterns: ["git status"],
      metadata: {},
      always: [],
    },
  ]
  await setup(page, data)
  await page.goto("/")
  const dock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
  await expect(dock).toContainText("git status")
  const permission = page.waitForRequest(
    (r) =>
      r.method() === "POST" && new URL(r.url()).pathname === "/api/session/ses_auto_1/permission/req_permission/reply",
  )
  await dock.getByRole("button", { name: "Allow once", exact: true }).click()
  expect((await permission).postDataJSON()).toEqual({ reply: "once" })
  data.permissions = []
  data.questions = [
    {
      id: "req_question",
      sessionID: "ses_auto_1",
      questions: [
        {
          header: "Choice",
          question: "Which approach?",
          options: [{ label: "Minimal", description: "Keep it simple" }],
        },
      ],
    },
  ]
  await page.reload()
  const question = page.locator('[data-component="dock-prompt"][data-kind="question"]')
  await question.getByRole("radio", { name: /Minimal/ }).click()
  const reply = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/session/ses_auto_1/question/req_question/reply",
  )
  await question.getByRole("button", { name: "Submit", exact: true }).click()
  expect((await reply).postDataJSON()).toEqual({ answers: [["Minimal"]] })
  expect(data.creates).toHaveLength(1)
})

test("recovers when the active session is deleted by another client", async ({ page }) => {
  const data = state()
  const transport = await installSseTransport(page, {
    server: `http://127.0.0.1:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
  })
  await setup(page, data)
  await page.goto("/")
  await ready(page, "ses_auto_1")
  await transport.waitForConnection()
  data.sessions.splice(0, 1)
  await transport.send({
    id: "evt_deleted",
    created: Date.now(),
    type: "session.deleted",
    durable: { aggregateID: "ses_auto_1", seq: 1, version: 2 },
    location: { directory },
    data: { sessionID: "ses_auto_1" },
  })
  await ready(page, "ses_auto_2")
  expect(data.creates).toEqual(["ses_auto_1", "ses_auto_2"])
})
