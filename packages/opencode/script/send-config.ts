import { createOpencodeClient } from "@opencode-ai/sdk/client"
import z from "zod"

const file = Bun.argv[2]
if (!file || Bun.argv.length !== 3) throw new Error("Usage: bun script/send-config.ts <config.json>")

const config = z
  .object({
    baseURL: z.url(),
    sessionID: z.string().min(1),
    text: z.string().regex(/\S/, "text must not be blank"),
  })
  .strict()
  .parse(await Bun.file(file).json())

const client = createOpencodeClient({ baseUrl: config.baseURL })
const session = await client.session.get({
  path: { id: config.sessionID },
  signal: AbortSignal.timeout(10_000),
  throwOnError: true,
})

console.log(`設定ファイル: ${file}`)
console.log(`送信先: ${session.data.id} (${session.data.title})`)
console.log(`本文: ${config.text}`)

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

console.log("送信APIが受け付けました。保存された本文とAIの応答はセッション履歴で確認できます。")
