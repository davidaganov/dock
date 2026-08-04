const {
  loadProjects,
  saveProjectsJson,
  parseTagLabel,
  formatOrderedTag,
  primaryTag
} = require("./projects")
const { UNCATEGORIZED_TAG, UNCATEGORIZED_KEY } = require("../core/constants")

const isUncategorizedKey = (tag) => {
  return tag === UNCATEGORIZED_KEY
}

const hasUncategorizedProjects = (projects) => {
  return projects.some((p) => p.enabled !== false && primaryTag(p) === UNCATEGORIZED_TAG)
}

const applyTagOrder = (tags, tagOrder) => {
  const set = new Set(tags)
  const ordered = []
  for (const tag of tagOrder || []) {
    if (set.has(tag)) {
      ordered.push(tag)
      set.delete(tag)
    }
  }
  return [...ordered, ...[...set].sort((a, b) => a.localeCompare(b))]
}

const collectSidebarTagKeys = (projects) => {
  const enabled = projects.filter((p) => p.enabled !== false)
  const counts = new Map()
  for (const p of enabled) {
    const tag = primaryTag(p)
    if (!tag) continue
    counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  return [...counts.keys()]
}

const effectiveSidebarTagKeys = (projects) => {
  const tags = collectSidebarTagKeys(projects)
  if (hasUncategorizedProjects(projects)) return [...tags, UNCATEGORIZED_KEY]
  return tags
}

const defaultSortTags = (tags) => {
  return [...tags]
    .filter((t) => !isUncategorizedKey(t))
    .sort((a, b) => {
      const pa = parseTagLabel(a)
      const pb = parseTagLabel(b)
      if (pa.prefix && pb.prefix) return a.localeCompare(b)
      if (pa.prefix) return -1
      if (pb.prefix) return 1
      return a.localeCompare(b)
    })
    .concat(tags.includes(UNCATEGORIZED_KEY) ? [UNCATEGORIZED_KEY] : [])
}

const listSidebarTags = (projects, tagOrder = null) => {
  const fromProjects = collectSidebarTagKeys(projects)
  const hasUncat = hasUncategorizedProjects(projects)

  if (!tagOrder?.length) {
    const tags = [...fromProjects]
    if (hasUncat) tags.push(UNCATEGORIZED_KEY)
    return defaultSortTags(tags)
  }

  const ordered = []
  const seen = new Set()

  for (const tag of tagOrder) {
    if (isUncategorizedKey(tag)) {
      if (hasUncat) {
        ordered.push(UNCATEGORIZED_KEY)
        seen.add(UNCATEGORIZED_KEY)
      }
      continue
    }
    ordered.push(tag)
    seen.add(tag)
  }

  for (const tag of fromProjects) {
    if (!seen.has(tag)) {
      ordered.push(tag)
      seen.add(tag)
    }
  }

  if (hasUncat && !seen.has(UNCATEGORIZED_KEY)) {
    ordered.push(UNCATEGORIZED_KEY)
  }

  return ordered
}

const syncTagOrder = (prefs, projects) => {
  const merged = listSidebarTags(projects, prefs.tagOrder)

  if (!prefs.tagOrder?.length && merged.length) {
    prefs.tagOrder = merged
    return true
  }

  const changed = JSON.stringify(prefs.tagOrder || []) !== JSON.stringify(merged)
  if (changed) prefs.tagOrder = merged
  return changed
}

const syncProjectOrderFromProjects = (prefs, projects) => {
  const next = {}
  const all = []
  for (const project of projects) {
    if (project.enabled === false) continue
    const tag = primaryTag(project)
    const scope = tag || UNCATEGORIZED_KEY
    if (!next[scope]) next[scope] = []
    next[scope].push(project.id)
    all.push(project.id)
  }
  next.__all__ = all

  const changed = JSON.stringify(prefs.projectOrder || {}) !== JSON.stringify(next)
  if (changed) {
    prefs.projectOrder = next
    if (prefs.listSort !== "recent") prefs.listSort = "custom"
  }
  return changed
}

const applyProjectOrderToJson = (projectOrder) => {
  const projects = loadProjects()
  if (!projects.length) return false

  const byId = new Map(projects.map((p) => [p.id, p]))
  const used = new Set()
  const next = []

  const scopes = [
    ...defaultSortTags(effectiveSidebarTagKeys(projects)).map((t) =>
      isUncategorizedKey(t) ? UNCATEGORIZED_KEY : t
    ),
    "__all__"
  ]

  const seenScopes = new Set()
  for (const scope of scopes) {
    if (seenScopes.has(scope)) continue
    seenScopes.add(scope)
    if (scope === "__all__") continue

    const expectedTag = scope === UNCATEGORIZED_KEY ? UNCATEGORIZED_TAG : scope
    const order = Array.isArray(projectOrder?.[scope]) ? projectOrder[scope] : []
    for (const id of order) {
      const project = byId.get(id)
      if (!project || used.has(id) || project.enabled === false) continue
      if (primaryTag(project) !== expectedTag) continue
      next.push(project)
      used.add(id)
    }
    for (const project of projects) {
      if (used.has(project.id) || project.enabled === false) continue
      if (primaryTag(project) !== expectedTag) continue
      next.push(project)
      used.add(project.id)
    }
  }

  for (const project of projects) {
    if (!used.has(project.id)) next.push(project)
  }

  const before = projects.map((p) => p.id).join("\n")
  const after = next.map((p) => p.id).join("\n")
  if (before === after) return false
  saveProjectsJson(next)
  return true
}

const reorderTagsInJson = (orderedTags) => {
  const numberedTags = (orderedTags || []).filter((t) => !isUncategorizedKey(t))
  if (!numberedTags.length) {
    throw new Error("tags required")
  }

  const projects = loadProjects()
  const labelToOldTag = new Map()
  for (const project of projects) {
    for (const tag of project.tags) {
      if (!tag) continue
      const { label } = parseTagLabel(tag)
      if (!labelToOldTag.has(label)) labelToOldTag.set(label, tag)
    }
  }

  const mapping = new Map()
  numberedTags.forEach((item, index) => {
    const { label } = parseTagLabel(String(item))
    if (!label) return
    const newTag = formatOrderedTag(index, label)
    const oldTag = labelToOldTag.get(label) || String(item)
    mapping.set(oldTag, newTag)
    mapping.set(label, newTag)
  })

  for (const project of projects) {
    project.tags = project.tags.map((tag) => {
      if (!tag) return tag
      if (mapping.has(tag)) return mapping.get(tag)
      const { label } = parseTagLabel(tag)
      if (mapping.has(label)) return mapping.get(label)
      return tag
    })
  }

  saveProjectsJson(projects)
  return mapping
}

const stripNumbersInProjectsJson = () => {
  const projects = loadProjects()
  for (const project of projects) {
    project.tags = project.tags.map((tag) => {
      if (!tag) return tag
      return parseTagLabel(tag).label
    })
  }
  saveProjectsJson(projects)
}

const applyNumbersToProjectsJson = (tagOrder) => {
  const projects = loadProjects()
  const labelToNumbered = new Map()
  ;(tagOrder || [])
    .filter((t) => !isUncategorizedKey(t))
    .forEach((tag, index) => {
      const { label } = parseTagLabel(tag)
      if (label) labelToNumbered.set(label, formatOrderedTag(index, label))
    })

  for (const project of projects) {
    project.tags = project.tags.map((tag) => {
      if (!tag) return tag
      const { label } = parseTagLabel(tag)
      return labelToNumbered.get(label) || tag
    })
  }
  saveProjectsJson(projects)
}

const renameTagInProjects = (oldTag, newLabel, stripNumbersInJson) => {
  if (isUncategorizedKey(oldTag)) throw new Error("Cannot rename uncategorized")
  const trimmed = String(newLabel || "").trim()
  if (!trimmed) throw new Error("name required")

  let newTag
  if (stripNumbersInJson) {
    newTag = trimmed
  } else {
    const { prefix } = parseTagLabel(oldTag)
    newTag = prefix ? `${prefix}${trimmed}` : trimmed
  }
  if (newTag === oldTag) return newTag

  const projects = loadProjects()
  for (const project of projects) {
    project.tags = project.tags.map((t) => (t === oldTag ? newTag : t))
  }
  saveProjectsJson(projects)
  return newTag
}

const createTagInOrder = (name, stripNumbersInJson, tagOrder) => {
  const label = String(name || "").trim()
  if (!label) throw new Error("name required")

  const existing = (tagOrder || []).filter((t) => !isUncategorizedKey(t))
  for (const tag of existing) {
    if (parseTagLabel(tag).label.toLowerCase() === label.toLowerCase()) {
      throw new Error("Category already exists")
    }
  }

  if (stripNumbersInJson) return label
  return formatOrderedTag(existing.length, label)
}

const deleteTagFromProjects = (tag) => {
  if (isUncategorizedKey(tag)) throw new Error("Cannot delete uncategorized")
  const projects = loadProjects()
  let count = 0
  for (const project of projects) {
    if (primaryTag(project) !== tag) continue
    project.tags = []
    count += 1
  }
  saveProjectsJson(projects)
  return count
}

const replaceTagInOrder = (tagOrder, oldTag, newTag) => {
  if (!Array.isArray(tagOrder)) return tagOrder
  return tagOrder.map((t) => (t === oldTag ? newTag : t))
}

const removeTagFromOrder = (tagOrder, tag) => {
  if (!Array.isArray(tagOrder)) return tagOrder
  return tagOrder.filter((t) => t !== tag)
}

const remapTagOrderAfterRenumber = (tagOrder, mapping) => {
  if (!Array.isArray(tagOrder)) return tagOrder
  return tagOrder.map((tag) => mapping.get(tag) || mapping.get(parseTagLabel(tag).label) || tag)
}

module.exports = {
  applyTagOrder,
  collectSidebarTagKeys,
  effectiveSidebarTagKeys,
  hasUncategorizedProjects,
  isUncategorizedKey,
  listSidebarTags,
  syncTagOrder,
  syncProjectOrderFromProjects,
  applyProjectOrderToJson,
  reorderTagsInJson,
  stripNumbersInProjectsJson,
  applyNumbersToProjectsJson,
  renameTagInProjects,
  createTagInOrder,
  deleteTagFromProjects,
  replaceTagInOrder,
  removeTagFromOrder,
  remapTagOrderAfterRenumber
}
