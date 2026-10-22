import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import type { SendConfig } from "./schema"

export async function sendPrompt(config: SendConfig) {
  const client = createOpencodeClient({ baseUrl: config.baseURL })
  const session = await client.session.get(
    { sessionID: config.sessionID },
    { signal: AbortSignal.timeout(10_000), throwOnError: true },
  )

  // agent と variant を渡さないと、サーバーが子の設定をデフォルトに書き換える
  const variant = session.data.model?.variant
  await client.session
    .promptAsync(
      {
        sessionID: session.data.id,
        directory: session.data.directory,
        agent: session.data.agent,
        ...(variant && variant !== "default" ? { variant } : {}),
        parts: [{ type: "text", text: config.text }],
      },
      { signal: AbortSignal.timeout(10_000), throwOnError: true },
    )
    .catch((cause) => {
      throw new Error("送信結果を確認できません。再送する前にセッション履歴を確認してください。", { cause })
    })
}
