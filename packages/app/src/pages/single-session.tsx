import { Button } from "@opencode-ai/ui/button"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createResource, Match, onCleanup, Switch, type ParentProps } from "solid-js"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { Persist } from "@/utils/persist"
import { ServerScope } from "@/utils/server-scope"
import { pathKey } from "@/utils/path-key"
import { sessionHref } from "@/utils/session-route"
import { ensureSingleSession } from "@/utils/single-session"

type SessionEvent = {
  type: string
  properties?: { sessionID?: string; info?: { id: string; time?: { archived?: number } } }
}

export function SingleSessionShell(props: ParentProps) {
  const server = useServer()
  const sdk = useServerSDK()
  const language = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const [session, { refetch }] = createResource(
    () => ({ sdk: sdk(), key: server.key }),
    async ({ sdk, key }) => {
      const directory = pathKey(
        (await sdk.protocol) === "v1"
          ? (await sdk.client.path.get({})).data!.directory
          : (await sdk.currentApi.location.get()).directory,
      )
      if (!directory) throw new Error("Missing backend working directory")
      // Web Locks (localhost/HTTPS only) serialize creation across tabs; without them we could create duplicates.
      if (!navigator.locks) throw new Error("Web Locks unavailable")
      // Scope by the actual server key: the canonical-local alias may later point at a different backend.
      const target = Persist.serverWorkspace(ServerScope.fromServerKey(key), directory, "single-session.v1")
      const name = `${target.storage}:${target.key}`
      const id = await navigator.locks.request(name, () =>
        ensureSingleSession({
          directory,
          read: () => localStorage.getItem(name),
          write: (id) => localStorage.setItem(name, id),
          get: (id) => sdk.api.session.get({ sessionID: id }),
          create: () => sdk.api.session.create({ location: { directory } }),
          prepare: async (sessionID) => {
            // Native-only v2 servers do not expose the legacy tool registry/metadata API.
            if ((await sdk.protocol) !== "v1") return
            // The server also verifies the session-bound marker: children/forks cannot inherit ownership.
            const result = await sdk.client.session.get({ sessionID, directory }, { throwOnError: true })
            if (!result.data) throw new Error("Missing coordinator session")
            const metadata = result.data.metadata ?? {}
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
            if (
              metadata["opencode.schedulerOwner"] === sessionID &&
              metadata["opencode.schedulerBaseURL"] === sdk.url &&
              metadata["opencode.schedulerTimezone"] === timezone
            )
              return
            await sdk.client.session.update(
              {
                sessionID,
                directory,
                metadata: {
                  ...metadata,
                  "opencode.schedulerOwner": sessionID,
                  "opencode.schedulerBaseURL": sdk.url,
                  "opencode.schedulerTimezone": timezone,
                },
              },
              { throwOnError: true },
            )
          },
        }),
      )
      return { id, href: sessionHref(key, id) }
    },
  )
  const ready = () => (session.state === "ready" ? session() : undefined)

  createEffect(() => {
    const href = ready()?.href
    if (href && location.pathname !== href) navigate(href, { replace: true })
  })

  // Replace the session when another client deletes or archives it.
  createEffect(() => {
    onCleanup(
      sdk().event.listen((event) => {
        const { type, properties } = event.details as SessionEvent
        const id = properties?.info?.id ?? properties?.sessionID
        if (!id || id !== ready()?.id) return
        if (type === "session.deleted" || type === "session.archived" || properties?.info?.time?.archived !== undefined)
          void refetch()
      }),
    )
  })

  return (
    <main data-component="single-session" class="h-dvh w-full min-w-0 flex flex-col bg-background-base text-text-base">
      <Switch
        fallback={
          <div role="status" class="m-auto p-6">
            {language.t("common.loading")}
          </div>
        }
      >
        <Match when={session.error}>
          <div role="alert" class="m-auto flex flex-col items-center gap-4 p-6">
            <p>{language.t("common.requestFailed")}</p>
            <Button onClick={() => void refetch()}>{language.t("common.continue")}</Button>
          </div>
        </Match>
        <Match when={ready()?.href === location.pathname}>{props.children}</Match>
      </Switch>
    </main>
  )
}
