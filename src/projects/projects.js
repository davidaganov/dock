const fs = require("fs")
const crypto = require("crypto")
const path = require("path")
const { UNCATEGORIZED_TAG } = require("../core/constants")
const { getProjectsJsonPath } = require("../config/config")
const { suppressProjectsWatch } = require("./projects-watch")

const isValidProjectId = (id) => {
  return typeof id === "string" && id.length > 0 && id.length <= 128
}

const newProjectId = () => {
  return crypto.randomUUID()
}

const loadProjectsRaw = () => {
  const filePath = getProjectsJsonPath()
  if (!fs.existsSync(filePath)) return []
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"))
  if (!Array.isArray(raw)) throw new Error("projects.json must be an array")
  return raw
}

const normalizeProjectEntry = (raw) => {
  if (!raw || typeof raw !== "object") return null
  const name = typeof raw.name === "string" ? raw.name.trim() : ""
  const rootPath = typeof raw.rootPath === "string" ? raw.rootPath.trim() : ""
  if (!name || !rootPath) return null

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : newProjectId()
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.filter((t) => typeof t === "string" && t))]
    : []

  return {
    id,
    name,
    rootPath,
    paths: Array.isArray(raw.paths) ? raw.paths.map(String) : [],
    tags,
    enabled: raw.enabled !== false,
    profile: typeof raw.profile === "string" ? raw.profile : ""
  }
}

const entryToJson = (entry) => {
  const json = {
    id: entry.id,
    name: entry.name,
    rootPath: entry.rootPath,
    paths: entry.paths || [],
    tags: entry.tags || [],
    profile: entry.profile || ""
  }
  if (entry.enabled === false) json.enabled = false
  return json
}

const saveProjectsJson = (entries) => {
  const filePath = getProjectsJsonPath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const payload = entries.map(entryToJson)
  const serialized = JSON.stringify(payload, null, "\t")
  const tmp = `${filePath}.tmp`
  const backup = `${filePath}.bak`

  suppressProjectsWatch()

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, backup)
    } catch {
      // A backup failure does not prevent saving the current project data.
    }
  }

  fs.writeFileSync(tmp, serialized, "utf8")
  fs.renameSync(tmp, filePath)
  return payload
}

const loadProjects = () => {
  try {
    const entries = loadProjectsRaw().map(normalizeProjectEntry).filter(Boolean)
    const byId = new Map()
    for (const entry of entries) {
      const prev = byId.get(entry.id)
      if (!prev || (prev.enabled === false && entry.enabled !== false)) {
        byId.set(entry.id, entry)
      }
    }
    return [...byId.values()]
  } catch {
    return []
  }
}

const normalizeRootPath = (rootPath) => {
  return path.resolve(String(rootPath || "")).replace(/\\/g, "/").toLowerCase()
}

const setProjectEnabledInJson = (id, enabled) => {
  const raw = loadProjectsRaw()
  let found = false
  let matchPath = ""
  for (const entry of raw) {
    if (entry?.id === id) {
      found = true
      matchPath = normalizeRootPath(entry.rootPath)
      break
    }
  }
  if (!found) throw new Error("Project not found")

  const nextRaw = raw.map((entry) => {
    if (!entry || typeof entry !== "object") return entry
    const sameId = entry.id === id
    const samePath = matchPath && normalizeRootPath(entry.rootPath) === matchPath
    if (!sameId && !samePath) return entry
    const copy = { ...entry }
    if (enabled) delete copy.enabled
    else copy.enabled = false
    return copy
  })

  const normalized = nextRaw.map(normalizeProjectEntry).filter(Boolean)
  saveProjectsJson(normalized)
  return (
    normalized.find((project) => project.id === id) ||
    normalized.find((project) => normalizeRootPath(project.rootPath) === matchPath)
  )
}

const restoreProjectById = (id) => setProjectEnabledInJson(id, true)

const hideProjectById = (id) => setProjectEnabledInJson(id, false)

const getProjectById = (id) => {
  if (!isValidProjectId(id)) return null
  return loadProjects().find((p) => p.id === id) || null
}

const updateProjectById = (id, patch) => {
  const projects = loadProjects()
  let found = false
  const nextProjects = projects.map((project) => {
    if (project.id !== id) return project
    found = true
    return {
      ...project,
      ...patch,
      id: project.id
    }
  })
  if (!found) throw new Error("Project not found")
  saveProjectsJson(nextProjects)
  return nextProjects.find((project) => project.id === id)
}

const removeProjectById = (id) => {
  const projects = loadProjects()
  const index = projects.findIndex((p) => p.id === id)
  if (index < 0) throw new Error("Project not found")
  const removed = projects[index]
  projects.splice(index, 1)
  saveProjectsJson(projects)
  return removed
}

const addProjectEntry = ({ name, rootPath, tags = [], enabled = true, id = null }) => {
  const projects = loadProjects()
  const normalizedPath = path.resolve(rootPath).replace(/\\/g, "/").toLowerCase()
  const existing = projects.find(
    (p) => p.rootPath.replace(/\\/g, "/").toLowerCase() === normalizedPath
  )
  if (existing) return existing

  const entry = {
    id: id || newProjectId(),
    name,
    rootPath: path.resolve(rootPath),
    paths: [],
    tags: Array.isArray(tags) ? tags : [tags].filter(Boolean),
    enabled,
    profile: ""
  }
  projects.push(entry)
  saveProjectsJson(projects)
  return entry
}

const addProjectsBatch = (items) => {
  const added = []
  for (const item of items) {
    if (!item?.path) continue
    const resolved = path.resolve(String(item.path))
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) continue
    const name = item.name?.trim() || path.basename(resolved)
    const tags = Array.isArray(item.tags) ? item.tags : item.tag ? [item.tag] : []
    added.push(
      addProjectEntry({
        name,
        rootPath: resolved,
        tags,
        enabled: item.enabled !== false
      })
    )
  }
  return added
}

const parseTagLabel = (tag) => {
  const text = String(tag || "").trim()
  const match = /^(\d+\.\s*)(.+)$/.exec(text)
  if (match) return { prefix: match[1], label: match[2], full: text }
  return { prefix: "", label: text, full: text }
}

const formatOrderedTag = (index, label) => {
  return `${String(index + 1).padStart(2, "0")}. ${label}`
}

const hideProjectsByTag = (tag) => {
  const projects = loadProjects()
  let count = 0
  for (const project of projects) {
    if (project.enabled === false) continue
    if (primaryTag(project) !== tag) continue
    project.enabled = false
    count++
  }
  saveProjectsJson(projects)
  return count
}

const primaryTag = (project) => {
  return (project.tags || [])[0] || UNCATEGORIZED_TAG
}

const projectsWithPrimaryTag = (projects, tag) => {
  return projects.filter((p) => p.enabled !== false && primaryTag(p) === tag)
}

const existingProjectPaths = () => {
  const set = new Set()
  for (const p of loadProjects()) {
    set.add(p.rootPath.replace(/\\/g, "/").toLowerCase())
  }
  return set
}

const isRemotePath = (rootPath) => {
  return /^vscode-remote:\/\//i.test(rootPath)
}

const resolveLocalPath = (rootPath) => {
  if (!rootPath || isRemotePath(rootPath)) return null
  const resolved = path.resolve(rootPath)
  if (!fs.existsSync(resolved)) return null
  return resolved
}

const projectPath = (project) => {
  return resolveLocalPath(project.rootPath)
}

const validateLocalProjectDir = (dirPath) => {
  const resolved = path.resolve(dirPath)
  if (!fs.existsSync(resolved)) throw new Error("Path not found")
  if (!fs.statSync(resolved).isDirectory()) throw new Error("Not a directory")
  return resolved
}

module.exports = {
  isValidProjectId,
  newProjectId,
  loadProjects,
  getProjectById,
  restoreProjectById,
  hideProjectById,
  updateProjectById,
  removeProjectById,
  addProjectEntry,
  addProjectsBatch,
  primaryTag,
  existingProjectPaths,
  isRemotePath,
  resolveLocalPath,
  projectPath,
  validateLocalProjectDir,
  saveProjectsJson,
  parseTagLabel,
  formatOrderedTag,
  hideProjectsByTag
}
