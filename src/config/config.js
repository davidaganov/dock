const fs = require("fs")
const path = require("path")
const { DOCK_CONFIG_PATH } = require("../core/constants")
const { defaultHomePath, defaultProjectsJsonPath } = require("../core/paths")

const CONFIG_KEYS = ["homePath", "projectsJsonPath", "onboardingCompleted"]

const defaultConfig = () => {
  const homePath = defaultHomePath()
  return {
    homePath,
    projectsJsonPath: defaultProjectsJsonPath(homePath),
    onboardingCompleted: false
  }
}

const readDockFile = () => {
  try {
    if (fs.existsSync(DOCK_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DOCK_CONFIG_PATH, "utf8"))
      if (raw && typeof raw === "object") return raw
    }
  } catch {
    // Invalid or unreadable configuration falls back to defaults.
  }
  return {}
}

const writeDockFile = (data) => {
  fs.writeFileSync(DOCK_CONFIG_PATH, JSON.stringify(data, null, 2), "utf8")
}

const normalizeConfig = (raw) => {
  const cfg = defaultConfig()
  if (!raw || typeof raw !== "object") return cfg

  if (typeof raw.homePath === "string" && raw.homePath.trim()) {
    cfg.homePath = path.resolve(raw.homePath.trim())
  }
  if (typeof raw.projectsJsonPath === "string" && raw.projectsJsonPath.trim()) {
    cfg.projectsJsonPath = path.resolve(raw.projectsJsonPath.trim())
  }
  if (typeof raw.onboardingCompleted === "boolean") {
    cfg.onboardingCompleted = raw.onboardingCompleted
  }

  return cfg
}

const loadConfig = () => {
  return normalizeConfig(readDockFile())
}

const saveConfig = (cfg) => {
  const normalized = normalizeConfig(cfg)
  const existing = readDockFile()
  const next = { ...existing }
  for (const key of CONFIG_KEYS) {
    next[key] = normalized[key]
  }
  writeDockFile(next)
  return normalized
}

const isConfigured = () => {
  return loadConfig().onboardingCompleted === true
}

const getProjectsJsonPath = () => {
  return loadConfig().projectsJsonPath
}

module.exports = {
  loadConfig,
  saveConfig,
  isConfigured,
  getProjectsJsonPath,
  defaultConfig,
  readDockFile,
  writeDockFile,
  CONFIG_KEYS
}
