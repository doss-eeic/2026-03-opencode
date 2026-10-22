import { describe, expect, test } from "bun:test"
import { sendPrompt } from "@/schedule/send"

describe("schedule.sendPrompt", () => {
  test("keeps the child's saved agent and variant", async () => {
    const session = {
      id: "ses_child",
      slug: "child",
      projectID: "project",
      directory: "/work/project",
      title: "child",
      version: "1",
      time: { created: 0, updated: 0 },
      agent: "general",
      model: { id: "test-model", providerID: "test", variant: "high" },
    }
    // 子セッションを返し、prompt_async に届いた body を記録するだけのサーバー
    const bodies: Record<string, unknown>[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (request.method === "GET") return Response.json(session)
        bodies.push(await request.json())
        return new Response(null, { status: 204 })
      },
    })

    await sendPrompt({ baseURL: server.url.origin, sessionID: session.id, text: "定期チェック" }).finally(() =>
      server.stop(true),
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.agent).toBe("general")
    expect(bodies[0]?.variant).toBe("high")
  })
})
