const { isValidProjectId } = require("../projects/projects")
const { readDockFile, writeDockFile, CONFIG_KEYS } = require("./config")

const defaultPreferences = () => {
  return {
    favoriteScripts: {},
    defaultScripts: {},
    scriptOrder: {},
    sidebarCollapsed: false,
    detailCollapsed: false,
    activeTag: null,
    terminalCollapsed: false,
    tagIcons: {},
    tagOrder: [],
    stripNumbersInJson: false,
    listView: "table",
    listSort: "name",
    listFilters: { running: false, dirty: false },
    recentProjects: {},
    projectOrder: {},
    categoryDirs: {},
    locale: "en"
  }
}

const normalizePreferences = (raw) => {
  const prefs = defaultPreferences()
  if (!raw || typeof raw !== "object") return prefs

  if (raw.favoriteScripts && typeof raw.favoriteScripts === "object") {
    for (const [id, scripts] of Object.entries(raw.favoriteScripts)) {
      if (!isValidProjectId(id) || !Array.isArray(scripts)) continue
      prefs.favoriteScripts[id] = scripts.filter((s) => typeof s === "string")
    }
  }

  if (raw.defaultScripts && typeof raw.defaultScripts === "object") {
    for (const [id, script] of Object.entries(raw.defaultScripts)) {
      if (!isValidProjectId(id) || typeof script !== "string") continue
      prefs.defaultScripts[id] = script
    }
  }

  if (raw.scriptOrder && typeof raw.scriptOrder === "object") {
    for (const [id, scripts] of Object.entries(raw.scriptOrder)) {
      if (!isValidProjectId(id)) continue
      if (Array.isArray(scripts)) {
        prefs.scriptOrder[id] = scripts.filter((s) => typeof s === "string")
      } else if (scripts && typeof scripts === "object") {
        const run = Array.isArray(scripts.run)
          ? scripts.run.filter((s) => typeof s === "string")
          : []
        const util = Array.isArray(scripts.util)
          ? scripts.util.filter((s) => typeof s === "string")
          : []
        if (run.length || util.length) {
          prefs.scriptOrder[id] = { run, util }
        }
      }
    }
  }

  if (typeof raw.sidebarCollapsed === "boolean") {
    prefs.sidebarCollapsed = raw.sidebarCollapsed
  }
  if (typeof raw.detailCollapsed === "boolean") {
    prefs.detailCollapsed = raw.detailCollapsed
  }
  if (typeof raw.activeTag === "string" || raw.activeTag === null) {
    prefs.activeTag = raw.activeTag
  }
  if (typeof raw.terminalCollapsed === "boolean") {
    prefs.terminalCollapsed = raw.terminalCollapsed
  }

  if (raw.tagIcons && typeof raw.tagIcons === "object") {
    for (const [tag, icon] of Object.entries(raw.tagIcons)) {
      if (typeof tag === "string" && typeof icon === "string" && icon.startsWith("mdi-")) {
        prefs.tagIcons[tag] = icon
      }
    }
  }

  if (Array.isArray(raw.tagOrder)) {
    prefs.tagOrder = raw.tagOrder.filter((t) => typeof t === "string" && t.trim())
  }
  if (typeof raw.stripNumbersInJson === "boolean") {
    prefs.stripNumbersInJson = raw.stripNumbersInJson
  }
  if (raw.listView === "table" || raw.listView === "cards") {
    prefs.listView = raw.listView
  }
  if (raw.listSort === "name" || raw.listSort === "recent" || raw.listSort === "custom") {
    prefs.listSort = raw.listSort
  }
  if (raw.listFilters && typeof raw.listFilters === "object") {
    prefs.listFilters = {
      running: !!raw.listFilters.running,
      dirty: !!raw.listFilters.dirty
    }
  }
  if (raw.locale === "ru" || raw.locale === "en") {
    prefs.locale = raw.locale
  }
  if (raw.categoryDirs && typeof raw.categoryDirs === "object") {
    for (const [tag, dir] of Object.entries(raw.categoryDirs)) {
      if (typeof tag === "string" && typeof dir === "string" && dir.trim()) {
        prefs.categoryDirs[tag] = dir.trim()
      }
    }
  }
  if (raw.projectOrder && typeof raw.projectOrder === "object") {
    for (const [scope, ids] of Object.entries(raw.projectOrder)) {
      if (typeof scope !== "string" || !Array.isArray(ids)) continue
      prefs.projectOrder[scope] = ids.filter((id) => isValidProjectId(id))
    }
  }
  if (raw.recentProjects && typeof raw.recentProjects === "object") {
    for (const [id, ts] of Object.entries(raw.recentProjects)) {
      if (!isValidProjectId(id) || typeof ts !== "number") continue
      prefs.recentProjects[id] = ts
    }
  }

  return prefs
}

const loadPreferences = () => {
  return normalizePreferences(readDockFile())
}

const savePreferences = (prefs) => {
  const existing = readDockFile()
  const next = {}
  for (const key of CONFIG_KEYS) {
    if (key in existing) next[key] = existing[key]
  }
  Object.assign(next, {
    favoriteScripts: prefs.favoriteScripts,
    defaultScripts: prefs.defaultScripts,
    scriptOrder: prefs.scriptOrder,
    sidebarCollapsed: prefs.sidebarCollapsed,
    detailCollapsed: prefs.detailCollapsed,
    activeTag: prefs.activeTag,
    terminalCollapsed: prefs.terminalCollapsed,
    tagIcons: prefs.tagIcons,
    tagOrder: prefs.tagOrder,
    stripNumbersInJson: prefs.stripNumbersInJson,
    listView: prefs.listView,
    listSort: prefs.listSort,
    listFilters: prefs.listFilters,
    recentProjects: prefs.recentProjects,
    projectOrder: prefs.projectOrder,
    categoryDirs: prefs.categoryDirs,
    locale: prefs.locale
  })
  writeDockFile(next)
}

const prunePreferences = (prefs, existingIds) => {
  const idSet = new Set(existingIds)
  let changed = false
  for (const id of Object.keys(prefs.favoriteScripts)) {
    if (!idSet.has(id)) {
      delete prefs.favoriteScripts[id]
      changed = true
    }
  }
  for (const id of Object.keys(prefs.defaultScripts)) {
    if (!idSet.has(id)) {
      delete prefs.defaultScripts[id]
      changed = true
    }
  }
  for (const id of Object.keys(prefs.scriptOrder)) {
    if (!idSet.has(id)) {
      delete prefs.scriptOrder[id]
      changed = true
    }
  }
  return changed
}

const cleanupProjectPreferences = (prefs, projectId) => {
  delete prefs.favoriteScripts[projectId]
  delete prefs.defaultScripts[projectId]
  delete prefs.scriptOrder[projectId]
}

const remapTagIconKey = (prefs, oldTag, newTag) => {
  if (!prefs.tagIcons[oldTag]) return
  prefs.tagIcons[newTag] = prefs.tagIcons[oldTag]
  delete prefs.tagIcons[oldTag]
}

const remapTagIconMap = (prefs, mapping) => {
  const next = { ...prefs.tagIcons }
  for (const [oldTag, newTag] of mapping.entries()) {
    if (next[oldTag]) {
      next[newTag] = next[oldTag]
      delete next[oldTag]
    }
  }
  prefs.tagIcons = next
}

module.exports = {
  loadPreferences,
  savePreferences,
  prunePreferences,
  cleanupProjectPreferences,
  remapTagIconKey,
  remapTagIconMap
}
