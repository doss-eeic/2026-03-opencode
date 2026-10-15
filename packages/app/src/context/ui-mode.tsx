import { createContext, useContext } from "solid-js"

// The browser entry renders one auto-created conversation; every other caller keeps the full UI.
export const SingleSessionContext = createContext(false)
export const useSingleSession = () => useContext(SingleSessionContext)

const commands = new Set([
  "settings.open",
  "command.palette",
  "session.undo",
  "session.redo",
  "session.compact",
  "session.export",
  "mcp.toggle",
  "file.attach",
])

export const singleSessionCommand = (id: string) =>
  commands.has(id) || /^(model|agent|input|message|permissions)\./.test(id)
