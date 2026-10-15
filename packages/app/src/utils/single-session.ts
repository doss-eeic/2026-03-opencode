import type { SessionInfo } from "@opencode-ai/client/promise"
import { isSessionNotFoundError } from "./server-errors"
import { pathKey } from "./path-key"

type Session = Pick<SessionInfo, "id" | "location" | "time" | "parentID">

// The legacy SDK throws the named response body rather than an Error.
const isNotFound = (error: unknown, id: string) =>
  isSessionNotFoundError(error, id) || (error as { name?: unknown } | null)?.name === "NotFoundError"

// Returns the remembered session while it is still usable, otherwise creates and remembers a new one.
// Call inside a cross-tab lock: storage is re-read here, never taken from a previously hydrated store.
export async function ensureSingleSession(input: {
  directory: string
  read: () => string | null
  write: (id: string) => void
  get: (id: string) => Promise<Session>
  create: () => Promise<Session>
}) {
  const id = input.read()
  const existing = id
    ? await input.get(id).catch((error: unknown) => {
        if (!isNotFound(error, id)) throw error
      })
    : undefined
  if (
    existing?.id === id &&
    !existing.parentID &&
    existing.time.archived === undefined &&
    pathKey(existing.location.directory) === pathKey(input.directory)
  )
    return existing.id
  const created = await input.create()
  input.write(created.id)
  return created.id
}
