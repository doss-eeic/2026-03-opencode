import { describe, expect, test } from "bun:test"
import { ensureSingleSession } from "./single-session"
import { singleSessionCommand } from "../context/ui-mode"

function fixture() {
  const state = { id: null as string | null, creates: 0 }
  const session = { id: "ses_main", location: { directory: "/work" }, time: { created: 1, updated: 1 } }
  const input = {
    directory: "/work",
    read: () => state.id,
    write: (id: string) => {
      state.id = id
    },
    get: async () => session,
    create: async () => {
      state.creates++
      return session
    },
  }
  return { state, session, input }
}

describe("persistent single session", () => {
  test("creates once and reads persisted identity on every subsequent resolution", async () => {
    const f = fixture()
    expect(await ensureSingleSession(f.input)).toBe("ses_main")
    expect(await ensureSingleSession(f.input)).toBe("ses_main")
    expect(f.state.creates).toBe(1)
  })

  test("replaces a confirmed deleted or archived session", async () => {
    for (const get of [
      async () => {
        throw { _tag: "SessionNotFoundError", sessionID: "ses_old" }
      },
      async () => {
        throw { name: "NotFoundError" }
      },
      async () => ({ id: "ses_old", location: { directory: "/work" }, time: { created: 1, updated: 1, archived: 2 } }),
    ]) {
      const f = fixture()
      f.state.id = "ses_old"
      expect(await ensureSingleSession({ ...f.input, get })).toBe("ses_main")
      expect(f.state.creates).toBe(1)
    }
  })

  test("never creates a replacement for network, authorization, or unclassified errors", async () => {
    for (const error of [
      new Error("offline"),
      { status: 401 },
      { status: 500 },
      { status: 404 },
      { _tag: "SessionNotFoundError", sessionID: "someone_else" },
    ]) {
      const f = fixture()
      f.state.id = "ses_main"
      await expect(
        ensureSingleSession({
          ...f.input,
          get: async () => {
            throw error
          },
        }),
      ).rejects.toBe(error)
      expect(f.state.creates).toBe(0)
      expect(f.state.id).toBe("ses_main")
    }
  })

  test("does not adopt a session from a different directory or a child session", async () => {
    for (const patch of [{ location: { directory: "/other" } }, { parentID: "ses_parent" }]) {
      const f = fixture()
      f.state.id = "ses_old"
      await ensureSingleSession({ ...f.input, get: async () => ({ ...f.session, id: "ses_old", ...patch }) })
      expect(f.state.creates).toBe(1)
    }
  })

  test("does not persist a failed creation", async () => {
    const f = fixture()
    await expect(
      ensureSingleSession({
        ...f.input,
        create: async () => {
          throw new Error("offline")
        },
      }),
    ).rejects.toThrow("offline")
    expect(f.state.id).toBeNull()
  })
})

test("single-session command policy retains chat essentials and blocks hidden surfaces", () => {
  for (const id of ["settings.open", "model.choose", "input.focus", "session.compact", "permissions.autoaccept"])
    expect(singleSessionCommand(id)).toBe(true)
  for (const id of [
    "session.new",
    "session.fork",
    "session.archive",
    "session.next",
    "tab.close",
    "file.open",
    "terminal.toggle",
    "fileTree.toggle",
    "review.toggle",
  ])
    expect(singleSessionCommand(id)).toBe(false)
})
