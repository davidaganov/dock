const path = require("path")
const fs = require("fs")
const { sendJson, readBody } = require("../core/http")
const { loadConfig, saveConfig } = require("../config/config")
const { loadProjects, parseTagLabel } = require("../projects/projects")
const { loadPreferences, savePreferences } = require("../config/preferences")
const {
  listSidebarTags,
  syncTagOrder,
  stripNumbersInProjectsJson,
  applyNumbersToProjectsJson,
  isUncategorizedKey
} = require("../projects/tags")
const { UNCATEGORIZED_KEY } = require("../core/constants")
const { resolveExistingDir, defaultProjectsJsonPath } = require("../core/paths")
const { startProjectsWatch } = require("../projects/projects-watch")

const remapTagIconsByLabel = (tagIcons, tagOrder) => {
  const next = {}
  for (const tag of tagOrder) {
    const label = parseTagLabel(tag).label
    if (tagIcons[tag]) next[tag] = tagIcons[tag]
    else if (tagIcons[label]) next[tag] = tagIcons[label]
  }
  for (const [key, icon] of Object.entries(tagIcons)) {
    const label = parseTagLabel(key).label
    const match = tagOrder.find((t) => t === key || parseTagLabel(t).label === label)
    if (match && !next[match]) next[match] = icon
  }
  return next
}

const handleSettingsApi = async (req, res, pathname) => {
  if (pathname !== "/api/settings") return false

  if (req.method === "GET") {
    const prefs = loadPreferences()
    const projects = loadProjects()
    if (syncTagOrder(prefs, projects)) savePreferences(prefs)
    const cfg = loadConfig()
    return sendJson(res, 200, {
      homePath: cfg.homePath,
      projectsJsonPath: cfg.projectsJsonPath,
      tagOrder: prefs.tagOrder,
      stripNumbersInJson: prefs.stripNumbersInJson,
      tags: listSidebarTags(projects, prefs.tagOrder)
    })
  }

  if (req.method === "PUT") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }

    const cfg = loadConfig()
    const prefs = loadPreferences()
    let projects = loadProjects()
    syncTagOrder(prefs, projects)

    const prevStrip = prefs.stripNumbersInJson

    if (typeof body.stripNumbersInJson === "boolean") {
      prefs.stripNumbersInJson = body.stripNumbersInJson
    }

    if (typeof body.homePath === "string" && body.homePath.trim()) {
      const resolved = resolveExistingDir(body.homePath.trim())
      if (!resolved) return sendJson(res, 400, { error: "Workspace folder not found" })
      cfg.homePath = resolved
    }

    if (typeof body.projectsJsonPath === "string" && body.projectsJsonPath.trim()) {
      cfg.projectsJsonPath = path.resolve(body.projectsJsonPath.trim())
      const dir = path.dirname(cfg.projectsJsonPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      if (!fs.existsSync(cfg.projectsJsonPath)) {
        fs.writeFileSync(cfg.projectsJsonPath, "[]\n", "utf8")
      }
    } else if (cfg.homePath && !cfg.projectsJsonPath) {
      cfg.projectsJsonPath = defaultProjectsJsonPath(cfg.homePath)
    }

    if (prefs.stripNumbersInJson !== prevStrip) {
      if (prefs.stripNumbersInJson) {
        const ordered = listSidebarTags(projects, prefs.tagOrder)
        const uncat = ordered.filter(isUncategorizedKey)
        prefs.tagOrder = ordered
          .filter((t) => !isUncategorizedKey(t))
          .map((t) => parseTagLabel(t).label)
          .concat(uncat)
        const plainIcons = {}
        for (const [tag, icon] of Object.entries(prefs.tagIcons)) {
          plainIcons[parseTagLabel(tag).label] = icon
        }
        prefs.tagIcons = plainIcons
        stripNumbersInProjectsJson()
      } else {
        applyNumbersToProjectsJson(prefs.tagOrder)
        projects = loadProjects()
        prefs.tagOrder = listSidebarTags(projects, null)
        prefs.tagIcons = remapTagIconsByLabel(prefs.tagIcons, prefs.tagOrder)
      }
    }

    saveConfig({ ...cfg, onboardingCompleted: true })
    savePreferences(prefs)
    projects = loadProjects()
    syncTagOrder(prefs, projects)
    savePreferences(prefs)
    startProjectsWatch()

    return sendJson(res, 200, {
      homePath: cfg.homePath,
      projectsJsonPath: cfg.projectsJsonPath,
      stripNumbersInJson: prefs.stripNumbersInJson,
      tagOrder: prefs.tagOrder,
      tagIcons: prefs.tagIcons,
      tags: listSidebarTags(projects, prefs.tagOrder)
    })
  }

  sendJson(res, 405, { error: "Method not allowed" })
  return true
}

module.exports = { handleSettingsApi }
