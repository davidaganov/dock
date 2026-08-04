const fs = require("fs")
const path = require("path")
const { UNCATEGORIZED_KEY } = require("../core/constants")
const { primaryTag, parseTagLabel } = require("./projects")
const { loadPreferences } = require("../config/preferences")

const inferCategoryDir = (tag, projects, homePath) => {
  if (!tag || tag === UNCATEGORIZED_KEY) return null

  const prefs = loadPreferences()
  const stored = prefs.categoryDirs?.[tag]
  if (typeof stored === "string" && stored.trim()) {
    const resolved = path.resolve(stored.trim())
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved
  }

  const inCategory = projects.filter(
    (p) => p.enabled !== false && primaryTag(p) === tag && p.rootPath
  )
  if (inCategory.length) {
    const parentCounts = new Map()
    for (const p of inCategory) {
      const parent = path.dirname(path.resolve(p.rootPath))
      parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1)
    }
    let best = null
    let bestCount = 0
    for (const [dir, count] of parentCounts) {
      if (count > bestCount) {
        best = dir
        bestCount = count
      }
    }
    if (best) return best
  }

  const label = parseTagLabel(tag).label
  const candidates = [
    path.join(homePath, label),
    path.join(homePath, label.toLowerCase()),
    path.join(homePath, label.replace(/\s+/g, "-").toLowerCase())
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return path.resolve(candidate)
    }
  }
  return null
}

const rememberCategoryDir = (prefs, tag, dir) => {
  if (!tag || tag === UNCATEGORIZED_KEY || !dir) return
  if (!prefs.categoryDirs || typeof prefs.categoryDirs !== "object") {
    prefs.categoryDirs = {}
  }
  prefs.categoryDirs[tag] = path.resolve(dir)
}

module.exports = { inferCategoryDir, rememberCategoryDir }
