import config from "./playwright.config"

export default {
  ...config,
  testMatch: "**/single-session.spec.ts",
  testIgnore: "performance/**",
  webServer: {
    ...config.webServer,
    env: { ...config.webServer?.env, VITE_OPENCODE_UI_MODE: "single-session" },
  },
}
