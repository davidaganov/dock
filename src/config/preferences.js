const { isValidProjectId } = require("../projects/projects")
const { readDockFile, writeDockFile, CONFIG_KEYS } = require("./config")

const defaultPreferences = () => {
  return {
    favoriteScripts: {},
    defaultScripts: {},
    scriptOrder: {},
    sidebarCollapsed: false,
    sidebarWidth: 200,
    detailCollapsed: false,
    detailKeepClosed: false,
    detailWidth: 420,
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
    locale: "en",
    detailTab: {},
    packageVariants: {},
    envOrder: {},
    packageOrder: {}
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
  if (typeof raw.sidebarWidth === "number" && raw.sidebarWidth >= 120 && raw.sidebarWidth <= 400) {
    prefs.sidebarWidth = Math.round(raw.sidebarWidth)
  }
  if (typeof raw.detailCollapsed === "boolean") {
    prefs.detailCollapsed = raw.detailCollapsed
  }
  if (typeof raw.detailKeepClosed === "boolean") {
    prefs.detailKeepClosed = raw.detailKeepClosed
  }
  if (typeof raw.detailWidth === "number" && raw.detailWidth >= 320) {
    prefs.detailWidth = Math.round(raw.detailWidth)
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
  if (raw.detailTab && typeof raw.detailTab === "object") {
    for (const [id, tab] of Object.entries(raw.detailTab)) {
      if (!isValidProjectId(id)) continue
      if (tab === "scripts" || tab === "env" || tab === "packages") prefs.detailTab[id] = tab
    }
  }

  if (raw.packageVariants && typeof raw.packageVariants === "object") {
    for (const [id, packages] of Object.entries(raw.packageVariants)) {
      if (!isValidProjectId(id) || !packages || typeof packages !== "object") continue
      const normalized = {}
      for (const [key, item] of Object.entries(packages)) {
        if (typeof key !== "string" || !item?.variants || !Array.isArray(item.variants)) continue
        const variants = item.variants
          .filter((v) => v && typeof v.value === "string")
          .map((v) => ({ value: v.value, active: !!v.active }))
        if (!variants.length) continue
        normalized[key] = { variants }
      }
      if (Object.keys(normalized).length) prefs.packageVariants[id] = normalized
    }
  }

  if (raw.envOrder && typeof raw.envOrder === "object") {
    for (const [id, keys] of Object.entries(raw.envOrder)) {
      if (!isValidProjectId(id) || !Array.isArray(keys)) continue
      const normalized = keys.filter((k) => typeof k === "string" && k.trim())
      if (normalized.length) prefs.envOrder[id] = [...new Set(normalized)]
    }
  }

  if (raw.packageOrder && typeof raw.packageOrder === "object") {
    for (const [id, sections] of Object.entries(raw.packageOrder)) {
      if (!isValidProjectId(id) || !sections || typeof sections !== "object") continue
      const dependencies = Array.isArray(sections.dependencies)
        ? sections.dependencies.filter((k) => typeof k === "string" && k.trim())
        : []
      const devDependencies = Array.isArray(sections.devDependencies)
        ? sections.devDependencies.filter((k) => typeof k === "string" && k.trim())
        : []
      if (dependencies.length || devDependencies.length) {
        prefs.packageOrder[id] = {
          dependencies: [...new Set(dependencies)],
          devDependencies: [...new Set(devDependencies)]
        }
      }
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
    sidebarWidth: prefs.sidebarWidth,
    detailCollapsed: prefs.detailCollapsed,
    detailKeepClosed: prefs.detailKeepClosed,
    detailWidth: prefs.detailWidth,
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
    locale: prefs.locale,
    detailTab: prefs.detailTab,
    packageVariants: prefs.packageVariants,
    envOrder: prefs.envOrder,
    packageOrder: prefs.packageOrder
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
  for (const id of Object.keys(prefs.detailTab)) {
    if (!idSet.has(id)) {
      delete prefs.detailTab[id]
      changed = true
    }
  }
  for (const id of Object.keys(prefs.packageVariants)) {
    if (!idSet.has(id)) {
      delete prefs.packageVariants[id]
      changed = true
    }
  }
  for (const id of Object.keys(prefs.envOrder)) {
    if (!idSet.has(id)) {
      delete prefs.envOrder[id]
      changed = true
    }
  }
  for (const id of Object.keys(prefs.packageOrder)) {
    if (!idSet.has(id)) {
      delete prefs.packageOrder[id]
      changed = true
    }
  }
  return changed
}

const cleanupProjectPreferences = (prefs, projectId) => {
  delete prefs.favoriteScripts[projectId]
  delete prefs.defaultScripts[projectId]
  delete prefs.scriptOrder[projectId]
  delete prefs.detailTab[projectId]
  delete prefs.packageVariants[projectId]
  delete prefs.envOrder[projectId]
  delete prefs.packageOrder[projectId]
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
