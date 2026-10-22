import { createOpencodeClient } from "@opencode-ai/sdk/client"
import type { SendConfig } from "./schema"

export async function sendPrompt(config: SendConfig) {
  const client = createOpencodeClient({ baseUrl: config.baseURL })
  const session = await client.session.get({
    path: { id: config.sessionID },
    signal: AbortSignal.timeout(10_000),
    throwOnError: true,
  })

  await client.session
    .promptAsync({
      path: { id: session.data.id },
      query: { directory: session.data.directory },
      body: { parts: [{ type: "text", text: config.text }] },
      signal: AbortSignal.timeout(10_000),
      throwOnError: true,
    })
    .catch((cause) => {
      throw new Error("送信結果を確認できません。再送する前にセッション履歴を確認してください。", { cause })
    })
}
