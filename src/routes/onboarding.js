const path = require("path")
const fs = require("fs")
const { sendJson, readBody } = require("../core/http")
const { loadConfig, saveConfig, isConfigured } = require("../config/config")
const { pickFolderDialog, pickFileDialog } = require("../system/explorer")
const { resolveExistingDir, defaultHomePath, defaultProjectsJsonPath } = require("../core/paths")

const handleOnboardingApi = async (req, res, pathname) => {
  if (req.method === "GET" && pathname === "/api/onboarding/status") {
    const cfg = loadConfig()
    return sendJson(res, 200, {
      configured: isConfigured(),
      config: cfg,
      defaults: {
        homePath: defaultHomePath(),
        projectsJsonPath: defaultProjectsJsonPath(defaultHomePath())
      }
    })
  }

  if (req.method === "POST" && pathname === "/api/onboarding/check-paths") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const homePath = body.homePath ? path.resolve(String(body.homePath)) : ""
    const projectsJsonPath = body.projectsJsonPath
      ? path.resolve(String(body.projectsJsonPath))
      : homePath
        ? defaultProjectsJsonPath(homePath)
        : ""
    return sendJson(res, 200, {
      homePath,
      projectsJsonPath,
      homeExists: homePath ? fs.existsSync(homePath) : false,
      projectsJsonExists: projectsJsonPath ? fs.existsSync(projectsJsonPath) : false
    })
  }

  if (req.method === "POST" && pathname === "/api/onboarding/ensure-paths") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    if (!body.homePath) return sendJson(res, 400, { error: "homePath required" })

    const homePath = path.resolve(String(body.homePath))
    const projectsJsonPath = body.projectsJsonPath
      ? path.resolve(String(body.projectsJsonPath))
      : defaultProjectsJsonPath(homePath)

    const created = { homeDir: false, projectsJson: false }

    if (!fs.existsSync(homePath)) {
      fs.mkdirSync(homePath, { recursive: true })
      created.homeDir = true
    } else if (!fs.statSync(homePath).isDirectory()) {
      return sendJson(res, 400, { error: "homePath is not a directory" })
    }

    const jsonDir = path.dirname(projectsJsonPath)
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true })
    }

    if (!fs.existsSync(projectsJsonPath)) {
      fs.writeFileSync(projectsJsonPath, "[]\n", "utf8")
      created.projectsJson = true
    }

    return sendJson(res, 200, {
      ok: true,
      created,
      homePath,
      projectsJsonPath,
      homeExists: true,
      projectsJsonExists: true
    })
  }

  if (req.method === "POST" && pathname === "/api/onboarding/pick-folder") {
    try {
      const selected = await pickFolderDialog()
      if (!selected) return sendJson(res, 200, { cancelled: true })
      const resolved = resolveExistingDir(selected)
      if (!resolved) return sendJson(res, 400, { error: "Folder not found" })
      return sendJson(res, 200, { cancelled: false, path: resolved })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/onboarding/pick-file") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const selected = await pickFileDialog({
        title: body.title || "Select a file"
      })
      if (!selected) return sendJson(res, 200, { cancelled: true })
      if (!fs.existsSync(selected)) return sendJson(res, 400, { error: "File not found" })
      return sendJson(res, 200, { cancelled: false, path: path.resolve(selected) })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/onboarding/complete") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }

    const homePath = resolveExistingDir(body.homePath)
    if (!homePath) return sendJson(res, 400, { error: "Enter an existing workspace folder" })

    const projectsJsonPath = body.projectsJsonPath
      ? path.resolve(String(body.projectsJsonPath))
      : defaultProjectsJsonPath(homePath)

    const projectsJsonDir = path.dirname(projectsJsonPath)
    if (!fs.existsSync(projectsJsonDir)) {
      fs.mkdirSync(projectsJsonDir, { recursive: true })
    }

    if (!fs.existsSync(projectsJsonPath)) {
      fs.writeFileSync(projectsJsonPath, "[]\n", "utf8")
    }

    saveConfig({
      homePath,
      projectsJsonPath,
      onboardingCompleted: true
    })

    return sendJson(res, 200, {
      ok: true,
      projectsJsonPath,
      homePath
    })
  }

  return false
}

module.exports = { handleOnboardingApi }
