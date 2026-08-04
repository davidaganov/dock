const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")
const { ROOT_DIR, PUBLIC_DIR, FAVICON_PATH, MIME } = require("../core/constants")
const { sendJson } = require("../core/http")
const { isConfigured } = require("../config/config")

const serveStatic = (req, res, pathname) => {
  if (pathname === "/favicon.ico" && fs.existsSync(FAVICON_PATH)) {
    res.writeHead(200, { "Content-Type": "image/x-icon" })
    fs.createReadStream(FAVICON_PATH).pipe(res)
    return
  }

  const needsOnboarding = !isConfigured()
  if (needsOnboarding) {
    const allowed =
      pathname === "/onboarding.html" ||
      pathname.startsWith("/onboarding.") ||
      pathname.startsWith("/api/")
    if (!allowed && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(302, { Location: "/onboarding.html" })
      res.end()
      return
    }
  }

  let filePath = path.join(
    PUBLIC_DIR,
    pathname === "/" ? "index.html" : pathname.replace(/^\//, "")
  )
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    sendJson(res, 403, { error: "Forbidden" })
    return
  }

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    sendJson(res, 404, { error: "Not found" })
    return
  }

  const ext = path.extname(resolved)
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" })
  fs.createReadStream(resolved).pipe(res)
}

const scheduleServerRestart = (server) => {
  const serverScript = path.join(ROOT_DIR, "server.js")
  const launcher = () =>
    spawn(process.execPath, [serverScript], {
      detached: true,
      stdio: "ignore",
      cwd: ROOT_DIR,
      env: process.env,
      windowsHide: true
    })

  setTimeout(() => {
    try {
      server.close(() => {
        const child = launcher()
        child.unref()
        process.exit(0)
      })
    } catch {
      process.exit(1)
    }
  }, 50)
}

module.exports = { serveStatic, scheduleServerRestart }
