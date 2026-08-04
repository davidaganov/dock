const http = require("http")
const { URL } = require("url")
const { PORT, HOST } = require("./core/constants")
const { sendJson } = require("./core/http")
const { loadConfig, isConfigured } = require("./config/config")
const { loadProjects } = require("./projects/projects")
const { initProcessManager, killAllOnShutdown } = require("./runtime/processes")
const { broadcast, addSseClient, removeSseClient } = require("./runtime/sse")
const { serveStatic, scheduleServerRestart } = require("./system/static")
const { handleOnboardingApi } = require("./routes/onboarding")
const { handleSettingsApi } = require("./routes/settings")
const { handleReposApi, handleSessionsApi, log } = require("./routes/api")
const { startProjectsWatch } = require("./projects/projects-watch")

initProcessManager({ broadcast, log })

const createApp = () => {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`)
    const pathname = url.pathname

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    if (pathname.startsWith("/api/")) {
      try {
        if (await handleOnboardingApi(req, res, pathname)) return
        if (await handleSettingsApi(req, res, pathname)) return
        if (await handleSessionsApi(req, res, pathname)) return

        if (req.method === "GET" && pathname === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive"
          })
          res.write(": connected\n\n")
          addSseClient(res)
          req.on("close", () => removeSseClient(res))
          return
        }

        if (
          await handleReposApi(req, res, pathname, {
            scheduleRestart: () => scheduleServerRestart(server)
          })
        ) {
          return
        }

        sendJson(res, 404, { error: "Not found" })
      } catch (err) {
        sendJson(res, 500, { error: err.message || "Internal error" })
      }
      return
    }

    serveStatic(req, res, pathname)
  })

  return server
}

const startServer = () => {
  const server = createApp()
  server.listen(PORT, HOST, () => {
    const cfg = loadConfig()
    console.log(`Dock → http://${HOST}:${PORT}`)
    console.log(`Home: ${cfg.homePath}`)
    console.log(`Projects: ${cfg.projectsJsonPath}`)
    console.log(`Configured: ${isConfigured()}`)
    console.log(`Node: ${process.execPath}`)
    console.log(`Entries: ${loadProjects().length}`)
    startProjectsWatch()
  })

  process.on("SIGINT", () => {
    killAllOnShutdown()
    process.exit(0)
  })

  return server
}

module.exports = { createApp, startServer }
