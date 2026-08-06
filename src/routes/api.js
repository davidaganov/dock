const { sendJson, readBody } = require("../core/http")
const { suppressProjectsWatch } = require("../projects/projects-watch")
const {
  isValidProjectId,
  loadProjects,
  hideProjectsByTag,
  parseTagLabel,
  addProjectEntry,
  getProjectById,
  updateProjectById,
  restoreProjectById,
  hideProjectById,
  removeProjectById,
  validateLocalProjectDir,
  projectPath
} = require("../projects/projects")
const {
  listSidebarTags,
  syncTagOrder,
  syncProjectOrderFromProjects,
  applyProjectOrderToJson,
  reorderTagsInJson,
  renameTagInProjects,
  replaceTagInOrder,
  createTagInOrder,
  deleteTagFromProjects,
  removeTagFromOrder,
  isUncategorizedKey
} = require("../projects/tags")
const {
  loadPreferences,
  savePreferences,
  prunePreferences,
  cleanupProjectPreferences,
  remapTagIconKey
} = require("../config/preferences")
const { UNCATEGORIZED_KEY } = require("../core/constants")
const { loadConfig, saveConfig } = require("../config/config")
const { discoverProjects, getRepoDetails } = require("../projects/project-service")
const { scanFolderTree, inferTagFromPath } = require("../projects/scan-tree")
const {
  pickFolderDialog,
  openInExplorer,
  openInIde,
  resolveExplorerPath
} = require("../system/explorer")
const {
  detectPackageManager,
  readPkgJson,
  pmCommand,
  pmRunShellLine,
  pmInstallCommand
} = require("../projects/project-meta")
const { runGit } = require("../projects/git")
const {
  startProcess,
  stopRepo,
  stopAllSessions,
  listAllSessions,
  getSession,
  killPort
} = require("../runtime/processes")
const { broadcast } = require("../runtime/sse")
const path = require("path")
const fs = require("fs")
const { resolveExistingDir, defaultHomePath } = require("../core/paths")
const { resolveCategoryDir, rememberCategoryDir } = require("../projects/category-dirs")
const { stopProjectsWatch, startProjectsWatch } = require("../projects/projects-watch")
const {
  parseEnvFile,
  writeEnvFile,
  normalizeEntries,
  setActiveVariant,
  addVariant,
  serializeEnvExport,
  writeEnvExample
} = require("../env/env-file")
const {
  loadPackageState,
  savePackageState,
  setActiveVariant: setPackageVariant,
  addVariant: addPackageVariant,
  updateVariantValue,
  normalizePackageEntries,
  variantsToPrefs
} = require("../packages/package-file")

const saveProjectPackageVariants = (projectId, variants) => {
  const prefs = loadPreferences()
  if (!variants || !Object.keys(variants).length) delete prefs.packageVariants[projectId]
  else prefs.packageVariants[projectId] = variants
  savePreferences(prefs)
}

const log = (repo, message, type = "info", sessionId = null, i18nKey = null, i18nParams = null) => {
  const entry = {
    time: new Date().toISOString(),
    repo,
    type,
    message: message || "",
    sessionId,
    i18nKey,
    i18nParams
  }
  process.stdout.write(`[${repo}] ${entry.message || i18nKey || ""}\n`)
  if (sessionId) {
    const session = getSession(sessionId)
    if (session) {
      session.buffer.push(entry)
      if (session.buffer.length > 2000) session.buffer.splice(0, session.buffer.length - 2000)
    }
  }
  broadcast("log", entry)
}

const handleReposApi = async (req, res, pathname) => {
  if (req.method === "GET" && pathname === "/api/repos") {
    const projects = discoverProjects()
    const enabledProjects = projects.filter((p) => p.enabled)
    const hiddenProjects = projects.filter((p) => !p.enabled)

    const detailedEnabled = await Promise.all(
      enabledProjects.map(async (p) => {
        const details = await getRepoDetails(p.id, { skipGit: true })
        return details ? { ...details, enabled: p.enabled } : null
      })
    )
    const detailedHidden = await Promise.all(
      hiddenProjects.map(async (p) => {
        const details = await getRepoDetails(p.id, { skipGit: true })
        return details ? { ...details, enabled: p.enabled } : null
      })
    )

    const prefs = loadPreferences()
    const allIds = projects.map((p) => p.id)
    let prefsChanged = prunePreferences(prefs, allIds)
    if (syncTagOrder(prefs, projects)) prefsChanged = true
    if (syncProjectOrderFromProjects(prefs, projects)) prefsChanged = true
    if (prefsChanged) savePreferences(prefs)

    const cfg = loadConfig()
    const tags = listSidebarTags(projects, prefs.tagOrder)

    return sendJson(res, 200, {
      workspace: cfg.homePath,
      homePath: cfg.homePath,
      projectsJsonPath: cfg.projectsJsonPath,
      tags,
      tagOrder: prefs.tagOrder,
      stripNumbersInJson: prefs.stripNumbersInJson,
      scriptOrder: prefs.scriptOrder,
      favoriteScripts: prefs.favoriteScripts,
      listView: prefs.listView,
      listSort: prefs.listSort,
      listFilters: prefs.listFilters,
      recentProjects: prefs.recentProjects,
      projectOrder: prefs.projectOrder,
      locale: prefs.locale,
      sidebarCollapsed: prefs.sidebarCollapsed,
      sidebarWidth: prefs.sidebarWidth,
      detailCollapsed: prefs.detailCollapsed,
      detailKeepClosed: prefs.detailKeepClosed,
      detailWidth: prefs.detailWidth,
      activeTag: prefs.activeTag,
      terminalCollapsed: prefs.terminalCollapsed,
      tagIcons: prefs.tagIcons,
      detailTab: prefs.detailTab,
      sessions: listAllSessions(),
      envOrder: prefs.envOrder,
      packageOrder: prefs.packageOrder,
      repos: detailedEnabled.filter(Boolean),
      hiddenRepos: detailedHidden.filter(Boolean)
    })
  }

  if (req.method === "GET" && pathname === "/api/tags") {
    const prefs = loadPreferences()
    const projects = loadProjects()
    syncTagOrder(prefs, projects)
    return sendJson(res, 200, { tags: listSidebarTags(projects, prefs.tagOrder) })
  }

  if (req.method === "PUT" && pathname === "/api/tags/order") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const ordered = Array.isArray(body.tags)
        ? body.tags.filter((t) => typeof t === "string")
        : null
      if (!ordered?.length) return sendJson(res, 400, { error: "tags required" })

      const prefs = loadPreferences()
      prefs.tagOrder = ordered

      if (prefs.stripNumbersInJson) {
        savePreferences(prefs)
        const tags = listSidebarTags(loadProjects(), prefs.tagOrder)
        return sendJson(res, 200, { tags, tagOrder: prefs.tagOrder, tagIcons: prefs.tagIcons })
      }

      const numberedOrder = ordered.filter((t) => !isUncategorizedKey(t))
      const before = listSidebarTags(loadProjects(), prefs.tagOrder)
      const mapping = reorderTagsInJson(numberedOrder)
      const projects = loadProjects()
      prefs.tagOrder = listSidebarTags(projects, null)
      for (const oldTag of before) {
        const oldLabel = parseTagLabel(oldTag).label
        const newTag = prefs.tagOrder.find((t) => parseTagLabel(t).label === oldLabel)
        if (newTag && newTag !== oldTag) remapTagIconKey(prefs, oldTag, newTag)
      }
      savePreferences(prefs)
      return sendJson(res, 200, {
        tags: listSidebarTags(projects, prefs.tagOrder),
        tagOrder: prefs.tagOrder,
        tagIcons: prefs.tagIcons
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/tags") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!name) return sendJson(res, 400, { error: "name required" })

      const prefs = loadPreferences()
      const projects = loadProjects()
      syncTagOrder(prefs, projects)
      const hadUncat = prefs.tagOrder.includes(UNCATEGORIZED_KEY)
      const newTag = createTagInOrder(name, prefs.stripNumbersInJson, prefs.tagOrder)
      const numbered = prefs.tagOrder.filter((t) => !isUncategorizedKey(t))
      if (!numbered.includes(newTag)) {
        prefs.tagOrder = [...numbered, newTag]
        if (hadUncat) prefs.tagOrder.push(UNCATEGORIZED_KEY)
      }
      savePreferences(prefs)
      return sendJson(res, 200, {
        tag: newTag,
        tags: listSidebarTags(projects, prefs.tagOrder),
        tagOrder: prefs.tagOrder,
        tagIcons: prefs.tagIcons
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "DELETE" && pathname === "/api/tags") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const tag = typeof body.tag === "string" ? body.tag : ""
      if (!tag || isUncategorizedKey(tag)) return sendJson(res, 400, { error: "tag required" })

      const count = deleteTagFromProjects(tag)
      const prefs = loadPreferences()
      prefs.tagOrder = removeTagFromOrder(prefs.tagOrder, tag)
      if (prefs.tagIcons[tag]) delete prefs.tagIcons[tag]
      savePreferences(prefs)

      const projects = loadProjects()
      syncTagOrder(prefs, projects)
      savePreferences(prefs)
      return sendJson(res, 200, {
        count,
        tags: listSidebarTags(projects, prefs.tagOrder),
        tagOrder: prefs.tagOrder,
        tagIcons: prefs.tagIcons
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "PUT" && pathname === "/api/tags/rename") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const tag = typeof body.tag === "string" ? body.tag : ""
      const name = typeof body.name === "string" ? body.name : ""
      if (!tag || isUncategorizedKey(tag)) return sendJson(res, 400, { error: "tag required" })

      const prefs = loadPreferences()
      const newTag = renameTagInProjects(tag, name, prefs.stripNumbersInJson)
      prefs.tagOrder = replaceTagInOrder(prefs.tagOrder, tag, newTag)
      remapTagIconKey(prefs, tag, newTag)
      savePreferences(prefs)

      const projects = loadProjects()
      return sendJson(res, 200, {
        tag: newTag,
        tags: listSidebarTags(projects, prefs.tagOrder),
        tagOrder: prefs.tagOrder,
        tagIcons: prefs.tagIcons
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/tags/hide") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const tag = typeof body.tag === "string" ? body.tag : ""
      if (!tag || isUncategorizedKey(tag)) return sendJson(res, 400, { error: "tag required" })
      const count = hideProjectsByTag(tag)
      const prefs = loadPreferences()
      const projects = loadProjects()
      syncTagOrder(prefs, projects)
      return sendJson(res, 200, {
        count,
        tags: listSidebarTags(projects, prefs.tagOrder)
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "PUT" && pathname === "/api/tags/icon") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const tag = typeof body.tag === "string" ? body.tag : ""
    const icon = typeof body.icon === "string" ? body.icon : ""
    if (!tag || !icon.startsWith("mdi-")) {
      return sendJson(res, 400, { error: "tag and mdi icon required" })
    }
    const prefs = loadPreferences()
    prefs.tagIcons[tag] = icon
    savePreferences(prefs)
    return sendJson(res, 200, { tagIcons: prefs.tagIcons })
  }

  if (req.method === "PUT" && pathname === "/api/preferences") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const prefs = loadPreferences()
    if (typeof body.sidebarCollapsed === "boolean") prefs.sidebarCollapsed = body.sidebarCollapsed
    if (typeof body.sidebarWidth === "number" && body.sidebarWidth >= 120 && body.sidebarWidth <= 400) {
      prefs.sidebarWidth = Math.round(body.sidebarWidth)
    }
    if (typeof body.detailCollapsed === "boolean") prefs.detailCollapsed = body.detailCollapsed
    if (typeof body.detailKeepClosed === "boolean") prefs.detailKeepClosed = body.detailKeepClosed
    if (typeof body.detailWidth === "number" && body.detailWidth >= 320) {
      prefs.detailWidth = Math.round(body.detailWidth)
    }
    if (typeof body.activeTag === "string" || body.activeTag === null) {
      prefs.activeTag = body.activeTag
    }
    if (typeof body.terminalCollapsed === "boolean") {
      prefs.terminalCollapsed = body.terminalCollapsed
    }
    if (body.listView === "table" || body.listView === "cards") {
      prefs.listView = body.listView
    }
    if (body.listSort === "name" || body.listSort === "recent" || body.listSort === "custom") {
      prefs.listSort = body.listSort
    }
    if (body.projectOrder && typeof body.projectOrder === "object") {
      prefs.projectOrder = {}
      for (const [scope, ids] of Object.entries(body.projectOrder)) {
        if (typeof scope !== "string" || !Array.isArray(ids)) continue
        prefs.projectOrder[scope] = ids.filter((id) => isValidProjectId(id))
      }
      applyProjectOrderToJson(prefs.projectOrder)
    }
    if (body.recentProjects && typeof body.recentProjects === "object") {
      prefs.recentProjects = body.recentProjects
    }
    if (body.listFilters && typeof body.listFilters === "object") {
      prefs.listFilters = {
        running: !!body.listFilters.running,
        dirty: !!body.listFilters.dirty
      }
    }
    if (body.locale === "ru" || body.locale === "en") {
      prefs.locale = body.locale
    }
    if (body.detailTab && typeof body.detailTab === "object") {
      prefs.detailTab = { ...prefs.detailTab }
      for (const [id, tab] of Object.entries(body.detailTab)) {
        if (!isValidProjectId(id)) continue
        if (tab === "scripts" || tab === "env" || tab === "packages") prefs.detailTab[id] = tab
        else delete prefs.detailTab[id]
      }
    }
    savePreferences(prefs)
    return sendJson(res, 200, { ok: true, preferences: prefs })
  }

  if (req.method === "POST" && pathname === "/api/explorer") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const target = resolveExplorerPath(body.path || null)
      await openInExplorer(target)
      sendJson(res, 200, { ok: true, path: target })
    } catch (err) {
      log("", err.message, "error")
      sendJson(res, 400, { error: err.message })
    }
    return true
  }

  if (req.method === "GET" && pathname === "/api/category-dir") {
    const url = new URL(req.url, "http://127.0.0.1")
    const tag = url.searchParams.get("tag") || ""
    if (!tag) {
      return sendJson(res, 400, { error: "tag required" })
    }
    const cfg = loadConfig()
    const projects = loadProjects()
    const dir = resolveCategoryDir(tag, projects, cfg.homePath)
    if (!dir) return sendJson(res, 404, { error: "categoryDirNotFound" })
    return sendJson(res, 200, {
      tag,
      dir,
      exists: fs.existsSync(dir) && fs.statSync(dir).isDirectory()
    })
  }

  if (req.method === "POST" && pathname === "/api/repos/create") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const method = typeof body.method === "string" ? body.method : ""
      const tag = typeof body.tag === "string" ? body.tag.trim() : ""
      const name = typeof body.name === "string" ? body.name.trim() : ""
      const repoUrl = typeof body.repoUrl === "string" ? body.repoUrl.trim() : ""

      if (!name) return sendJson(res, 400, { error: "name required" })
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        return sendJson(res, 400, { error: "invalid name" })
      }

      const cfg = loadConfig()
      const projects = loadProjects()
      const uncategorized = !tag || isUncategorizedKey(tag)
      const categoryDir = resolveCategoryDir(
        uncategorized ? UNCATEGORIZED_KEY : tag,
        projects,
        cfg.homePath,
        { mkdir: !uncategorized }
      )
      if (!categoryDir) {
        return sendJson(res, 404, {
          error: uncategorized ? "homePathNotFound" : "categoryDirNotFound"
        })
      }

      const prefs = loadPreferences()
      if (!uncategorized) rememberCategoryDir(prefs, tag, categoryDir)
      savePreferences(prefs)

      const targetPath = path.join(categoryDir, name)
      if (fs.existsSync(targetPath)) {
        return sendJson(res, 400, { error: "pathExists" })
      }

      if (method === "folder") {
        fs.mkdirSync(targetPath, { recursive: true })
      } else if (method === "clone") {
        if (!repoUrl) return sendJson(res, 400, { error: "repoUrl required" })
        await runGit(categoryDir, ["clone", repoUrl, name])
      } else {
        return sendJson(res, 400, { error: "method required" })
      }

      const project = addProjectEntry({
        name,
        rootPath: targetPath,
        tags: uncategorized ? [] : [tag]
      })
      log("", "", "success", null, "log.projectAdded", {
        name: project.name,
        path: project.rootPath
      })
      const details = await getRepoDetails(project.id)
      return sendJson(res, 200, { ok: true, project, repo: details, created: true })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/repos/register") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      if (!body.path) return sendJson(res, 400, { error: "path required" })
      const resolved = validateLocalProjectDir(body.path)
      const name = body.name?.trim() || path.basename(resolved)
      const tags = Array.isArray(body.tags) ? body.tags : body.tag ? [body.tag] : []
      const project = addProjectEntry({
        name,
        rootPath: resolved,
        tags,
        enabled: body.enabled !== false
      })
      log("", "", "success", null, "log.projectAdded", {
        name: project.name,
        path: project.rootPath
      })
      const details = await getRepoDetails(project.id)
      return sendJson(res, 200, { project, repo: details, created: true })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/repos/browse") {
    try {
      const selected = await pickFolderDialog()
      if (!selected) return sendJson(res, 200, { cancelled: true })
      const resolved = validateLocalProjectDir(selected)
      const name = path.basename(resolved)
      const project = addProjectEntry({ name, rootPath: resolved, tags: [] })
      log("", "", "success", null, "log.projectAdded", {
        name: project.name,
        path: project.rootPath
      })
      const details = await getRepoDetails(project.id)
      return sendJson(res, 200, { cancelled: false, project, repo: details, created: true })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST" && pathname === "/api/repos/scan") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const cfg = loadConfig()
      const root = resolveExistingDir(body.root || cfg.homePath || defaultHomePath())
      if (!root) return sendJson(res, 400, { error: "Root folder not found" })

      const tree = scanFolderTree(root, body.maxDepth || 5)
      const { flattenFolderTree } = require("../projects/scan-tree")
      const flat = flattenFolderTree(tree).filter((n) => n.depth > 0)
      const known = new Set(loadProjects().map((p) => p.rootPath.replace(/\\/g, "/").toLowerCase()))
      const unknown = flat.filter((item) => !known.has(item.path.replace(/\\/g, "/").toLowerCase()))

      let added = 0
      const tag = typeof body.tag === "string" ? body.tag : ""
      if (body.autoAdd && unknown.length) {
        for (const item of unknown) {
          addProjectEntry({
            name: item.name,
            rootPath: item.path,
            tags: tag
              ? [tag]
              : inferTagFromPath(item.path, root)
                ? [inferTagFromPath(item.path, root)]
                : []
          })
          added += 1
        }
      }

      log("", `Scan ${root}: found ${unknown.length}, added ${added}`, "success")
      return sendJson(res, 200, {
        root,
        found: unknown,
        added,
        total: loadProjects().length
      })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "PUT" && pathname === "/api/config/home") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const cfg = loadConfig()
    if (body.path) {
      const resolved = resolveExistingDir(body.path)
      if (!resolved) return sendJson(res, 400, { error: "Invalid home path" })
      cfg.homePath = resolved
    }
    if (body.projectsJsonPath) {
      cfg.projectsJsonPath = path.resolve(String(body.projectsJsonPath))
    }
    saveConfig(cfg)
    return sendJson(res, 200, cfg)
  }

  if (req.method === "POST" && pathname === "/api/restart") {
    const stopped = stopAllSessions()
    stopProjectsWatch()
    startProjectsWatch()
    log("", `Dock restarted (stopped ${stopped} sessions)`, "warning")
    return sendJson(res, 200, { ok: true, stopped, reload: true })
  }

  if (req.method === "POST" && pathname === "/api/ports/kill") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const port = parseInt(body.port, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return sendJson(res, 400, { error: "Invalid port (1–65535)" })
    }
    try {
      const result = await killPort(port)
      if (result.freed) {
        const msg =
          result.stopped.length > 0
            ? `Port ${port} freed (PIDs: ${result.stopped.join(", ")})`
            : `Port ${port} is already free`
        log("", msg, "success")
      } else {
        log("", `Port ${port} is still in use`, "error")
      }
      sendJson(res, 200, result)
    } catch (err) {
      log("", err.message, "error")
      sendJson(res, 500, { error: err.message })
    }
    return true
  }

  if (req.method === "PUT" && pathname === "/api/uncategorized/projects") {
    return sendJson(res, 410, { error: "Removed" })
  }

  const repoMatch = pathname.match(/^\/api\/repos\/([^/]+)(\/.*)?$/)
  if (!repoMatch) return false

  const projectId = decodeURIComponent(repoMatch[1])
  const sub = repoMatch[2] || ""

  if (req.method === "GET" && sub === "") {
    const details = await getRepoDetails(projectId)
    if (!details) return sendJson(res, 404, { error: "Project not found" })
    sendJson(res, 200, details)
    return true
  }

  if (req.method === "DELETE" && sub === "") {
    try {
      const removed = removeProjectById(projectId)
      const prefs = loadPreferences()
      cleanupProjectPreferences(prefs, projectId)
      savePreferences(prefs)
      log("", "", "warning", null, "log.projectRemoved", { name: removed.name })
      return sendJson(res, 200, { ok: true, removed })
    } catch (err) {
      return sendJson(res, 404, { error: err.message })
    }
  }

  if (req.method === "PATCH" && sub === "") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const patch = {}
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim()
      if (typeof body.rootPath === "string" && body.rootPath.trim()) {
        patch.rootPath = body.rootPath.trim()
      }
      if (typeof body.tag === "string") {
        const trimmed = body.tag.trim()
        patch.tags = !trimmed || trimmed === UNCATEGORIZED_KEY ? [] : [trimmed]
      }
      if (Array.isArray(body.tags)) {
        patch.tags = body.tags.filter((t) => typeof t === "string")
      }
      if (typeof body.enabled === "boolean") {
        patch.enabled = body.enabled
      }
      const updated = updateProjectById(projectId, patch)
      broadcast("repo-update", { name: projectId })
      const details = await getRepoDetails(updated.id)
      return sendJson(res, 200, { project: updated, repo: details })
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "PUT" && sub === "/script-order") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    if (!getProjectById(projectId)) return sendJson(res, 404, { error: "Project not found" })

    const prefs = loadPreferences()
    if (body.run || body.util) {
      const run = Array.isArray(body.run) ? body.run.filter((s) => typeof s === "string") : []
      const util = Array.isArray(body.util) ? body.util.filter((s) => typeof s === "string") : []
      if (run.length || util.length) {
        prefs.scriptOrder[projectId] = { run, util }
      } else {
        delete prefs.scriptOrder[projectId]
      }
      savePreferences(prefs)
      return sendJson(res, 200, {
        scriptOrder: prefs.scriptOrder[projectId] || { run: [], util: [] }
      })
    }

    const scripts = Array.isArray(body.scripts)
      ? body.scripts.filter((s) => typeof s === "string")
      : null
    if (!scripts) return sendJson(res, 400, { error: "scripts required" })

    if (scripts.length) prefs.scriptOrder[projectId] = [...new Set(scripts)]
    else delete prefs.scriptOrder[projectId]
    savePreferences(prefs)
    return sendJson(res, 200, { scriptOrder: prefs.scriptOrder[projectId] || [] })
  }

  if (req.method === "PUT" && sub === "/env-order") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    if (!getProjectById(projectId)) return sendJson(res, 404, { error: "Project not found" })

    const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string") : null
    if (!keys) return sendJson(res, 400, { error: "keys required" })

    const prefs = loadPreferences()
    if (keys.length) prefs.envOrder[projectId] = [...new Set(keys)]
    else delete prefs.envOrder[projectId]
    savePreferences(prefs)
    return sendJson(res, 200, { envOrder: prefs.envOrder[projectId] || [] })
  }

  if (req.method === "PUT" && sub === "/package-order") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    if (!getProjectById(projectId)) return sendJson(res, 404, { error: "Project not found" })

    const dependencies = Array.isArray(body.dependencies)
      ? body.dependencies.filter((k) => typeof k === "string")
      : []
    const devDependencies = Array.isArray(body.devDependencies)
      ? body.devDependencies.filter((k) => typeof k === "string")
      : []
    const prefs = loadPreferences()
    if (dependencies.length || devDependencies.length) {
      prefs.packageOrder[projectId] = {
        dependencies: [...new Set(dependencies)],
        devDependencies: [...new Set(devDependencies)]
      }
    } else {
      delete prefs.packageOrder[projectId]
    }
    savePreferences(prefs)
    return sendJson(res, 200, {
      packageOrder: prefs.packageOrder[projectId] || { dependencies: [], devDependencies: [] }
    })
  }

  const project = getProjectById(projectId)
  const repoPath = project ? projectPath(project) : null

  if (req.method === "GET" && sub === "/env") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    if (!repoPath) return sendJson(res, 400, { error: "Project is not available locally" })
    return sendJson(res, 200, parseEnvFile(repoPath))
  }

  if (req.method === "GET" && sub === "/env/export") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    if (!repoPath) return sendJson(res, 400, { error: "Project is not available locally" })
    const parsed = parseEnvFile(repoPath)
    if (!parsed.exists) return sendJson(res, 404, { error: ".env not found" })
    const url = new URL(req.url, "http://127.0.0.1")
    const includeCommented =
      url.searchParams.get("includeCommented") === "1" ||
      url.searchParams.get("includeCommented") === "true"
    const text = serializeEnvExport(parsed.entries, parsed.eol, { includeCommented })
    return sendJson(res, 200, { text, eol: parsed.eol })
  }

  if (req.method === "PUT" && sub === "/env") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    if (!repoPath) return sendJson(res, 400, { error: "Project is not available locally" })
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const entries = normalizeEntries(body.entries || [])
      const result = writeEnvFile(repoPath, entries)
      log(projectId, "Updated .env", "success")
      return sendJson(res, 200, result)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "PUT" && sub === "/favorite-scripts") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const scripts = Array.isArray(body.scripts)
      ? body.scripts.filter((s) => typeof s === "string")
      : null
    if (!scripts) return sendJson(res, 400, { error: "scripts required" })
    const prefs = loadPreferences()
    if (scripts.length) prefs.favoriteScripts[projectId] = [...new Set(scripts)]
    else delete prefs.favoriteScripts[projectId]
    savePreferences(prefs)
    return sendJson(res, 200, { favoriteScripts: prefs.favoriteScripts[projectId] || [] })
  }

  if (req.method === "GET" && sub === "/packages") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    if (!repoPath) return sendJson(res, 400, { error: "Project is not available locally" })
    const prefs = loadPreferences()
    const saved = prefs.packageVariants[projectId] || {}
    return sendJson(res, 200, loadPackageState(repoPath, saved))
  }

  if (req.method === "PUT" && sub === "/packages") {
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    if (!repoPath) return sendJson(res, 400, { error: "Project is not available locally" })
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    try {
      const entries = normalizePackageEntries(body.entries || [])
      const result = savePackageState(repoPath, entries)
      saveProjectPackageVariants(projectId, variantsToPrefs(entries))
      log(projectId, "Updated package.json", "success")
      return sendJson(res, 200, result)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }
  }

  if (req.method === "POST") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }

    const project = getProjectById(projectId)
    if (!project) return sendJson(res, 404, { error: "Project not found" })
    const repoPath = projectPath(project)
    if (!repoPath && sub !== "/hide" && sub !== "/show") {
      return sendJson(res, 400, { error: "Project is not available locally" })
    }

    try {
      if (sub === "/env/variant") {
        const { key, variantIndex } = body
        if (!key || typeof key !== "string") {
          return sendJson(res, 400, { error: "key required" })
        }
        const parsed = parseEnvFile(repoPath)
        const entries = setActiveVariant(parsed.entries, key, variantIndex)
        const result = writeEnvFile(repoPath, entries)
        log(projectId, `ENV ${key} → variant ${variantIndex}`, "success")
        return sendJson(res, 200, result)
      }

      if (sub === "/env/variants") {
        const { key, value } = body
        if (!key || typeof key !== "string") {
          return sendJson(res, 400, { error: "key required" })
        }
        if (typeof value !== "string") {
          return sendJson(res, 400, { error: "value required" })
        }
        const parsed = parseEnvFile(repoPath)
        const entries = addVariant(parsed.entries, key, value)
        const result = writeEnvFile(repoPath, entries)
        log(projectId, `ENV ${key} variant added`, "success")
        return sendJson(res, 200, result)
      }

      if (sub === "/env/example") {
        const parsed = parseEnvFile(repoPath)
        if (!parsed.exists) return sendJson(res, 404, { error: ".env not found" })
        const includeCommented = !!body.includeCommented
        const result = writeEnvExample(repoPath, parsed.entries, { includeCommented })
        log(projectId, "Generated .env.example", "success")
        return sendJson(res, 200, { ok: true, path: result.path })
      }

      if (sub === "/packages/variant") {
        const { key, variantIndex } = body
        if (!key || typeof key !== "string") {
          return sendJson(res, 400, { error: "key required" })
        }
        const prefs = loadPreferences()
        const saved = prefs.packageVariants[projectId] || {}
        const { state, packageVariants } = setPackageVariant(repoPath, saved, key, variantIndex)
        saveProjectPackageVariants(projectId, packageVariants)
        log(projectId, `Package ${key} → variant ${variantIndex}`, "success")
        return sendJson(res, 200, { ...state, needsInstall: true })
      }

      if (sub === "/packages/variants") {
        const { key, value } = body
        if (!key || typeof key !== "string") {
          return sendJson(res, 400, { error: "key required" })
        }
        if (typeof value !== "string") {
          return sendJson(res, 400, { error: "value required" })
        }
        const prefs = loadPreferences()
        const saved = prefs.packageVariants[projectId] || {}
        const { state, packageVariants } = addPackageVariant(repoPath, saved, key, value)
        saveProjectPackageVariants(projectId, packageVariants)
        log(projectId, `Package ${key} variant added`, "success")
        return sendJson(res, 200, state)
      }

      if (sub === "/packages/value") {
        const { key, variantIndex, value } = body
        if (!key || typeof key !== "string") {
          return sendJson(res, 400, { error: "key required" })
        }
        if (typeof value !== "string") {
          return sendJson(res, 400, { error: "value required" })
        }
        const prefs = loadPreferences()
        const saved = prefs.packageVariants[projectId] || {}
        const { state, packageVariants, wrotePackageJson } = updateVariantValue(
          repoPath,
          saved,
          key,
          variantIndex,
          value
        )
        saveProjectPackageVariants(projectId, packageVariants)
        log(projectId, `Package ${key} value updated`, "success")
        return sendJson(res, 200, { ...state, needsInstall: wrotePackageJson })
      }

      if (sub === "/checkout") {
        const { branch } = body
        if (!branch) return sendJson(res, 400, { error: "branch required" })
        await runGit(repoPath, ["checkout", branch])
        log(projectId, `Switched to branch: ${branch}`, "success")
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { ok: true, branch })
      }

      if (sub === "/pull") {
        const out = await runGit(repoPath, ["pull", "--ff-only"])
        log(projectId, out || "Pull complete", "success")
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { ok: true, output: out })
      }

      if (sub === "/fetch") {
        await runGit(repoPath, ["fetch", "--all", "--prune"])
        log(projectId, "Fetch complete", "success")
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { ok: true })
      }

      if (sub === "/ide") {
        await openInIde(repoPath)
        return sendJson(res, 200, { ok: true })
      }

      if (sub === "/install") {
        const pm = detectPackageManager(repoPath)
        const { cmd, args } = pmInstallCommand(pm)
        const result = startProcess(projectId, repoPath, cmd, args, { label: "install" })
        return sendJson(res, 200, result)
      }

      if (sub === "/exec") {
        const { command } = body
        if (!command || typeof command !== "string") {
          return sendJson(res, 400, { error: "command required" })
        }
        const trimmed = command.trim()
        if (!trimmed) return sendJson(res, 400, { error: "command required" })
        const result = startProcess(projectId, repoPath, trimmed, [], {
          label: trimmed,
          shellLine: trimmed
        })
        return sendJson(res, 200, result)
      }

      if (sub === "/run") {
        const { script } = body
        if (!script) return sendJson(res, 400, { error: "script required" })
        const parsed = readPkgJson(repoPath)
        if (!parsed?.pkg?.scripts?.[script]) {
          return sendJson(res, 400, { error: `Script not found: ${script}` })
        }
        const pm = detectPackageManager(repoPath)
        const { cmd, args } = pmCommand(pm, script)
        const shellLine = pmRunShellLine(pm, script)
        const result = startProcess(projectId, repoPath, cmd, args, { label: script, shellLine })
        return sendJson(res, 200, result)
      }

      if (sub === "/stop") {
        const stopped = stopRepo(projectId)
        if (stopped) log(projectId, "All processes stopped", "success")
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { ok: true, stopped })
      }

      if (sub === "/hide") {
        const updated = hideProjectById(projectId)
        suppressProjectsWatch(3000)
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { project: updated })
      }

      if (sub === "/show") {
        const updated = restoreProjectById(projectId)
        suppressProjectsWatch(3000)
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { project: updated })
      }

      sendJson(res, 404, { error: "Not found" })
    } catch (err) {
      log(projectId, err.message, "error")
      sendJson(res, 500, { error: err.message })
    }
    return true
  }

  sendJson(res, 405, { error: "Method not allowed" })
  return true
}

const handleSessionsApi = async (req, res, pathname) => {
  if (req.method === "POST" && pathname === "/api/terminal/workspace") {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : ""
    const command = typeof body.command === "string" ? body.command.trim() : ""
    if (!cwd || !command) return sendJson(res, 400, { error: "cwd and command required" })
    const resolved = resolveExistingDir(cwd)
    if (!resolved) return sendJson(res, 400, { error: "cwd not found" })
    const pseudoId = `ws_${Date.now()}`
    const result = startProcess(pseudoId, resolved, command, [], {
      label: typeof body.label === "string" ? body.label : command,
      shellLine: command
    })
    return sendJson(res, 200, result)
  }

  if (req.method === "GET" && pathname === "/api/sessions") {
    sendJson(res, 200, { sessions: listAllSessions() })
    return true
  }

  if (req.method === "GET" && pathname.match(/^\/api\/sessions\/[^/]+\/logs$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3])
    const session = getSession(sessionId)
    if (!session) return sendJson(res, 404, { error: "Session not found" })
    return sendJson(res, 200, { sessionId, logs: session.buffer })
  }

  if (req.method === "POST" && pathname === "/api/sessions/close-all") {
    const { stopAllSessions } = require("../runtime/processes")
    const stopped = stopAllSessions()
    return sendJson(res, 200, { ok: true, stopped })
  }

  if (req.method === "POST" && pathname.match(/^\/api\/sessions\/[^/]+\/stdin$/)) {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON" })
    }
    const sessionId = decodeURIComponent(pathname.split("/")[3])
    const { writeSessionInput } = require("../runtime/processes")
    const data = typeof body.data === "string" ? body.data : ""
    if (!data) return sendJson(res, 400, { error: "data required" })
    const ok = writeSessionInput(sessionId, data)
    if (!ok) return sendJson(res, 404, { error: "Session not writable" })
    return sendJson(res, 200, { ok: true })
  }

  if (req.method === "POST" && pathname.match(/^\/api\/sessions\/[^/]+\/stop$/)) {
    const sessionId = decodeURIComponent(pathname.split("/")[3])
    const { stopSession } = require("../runtime/processes")
    stopSession(sessionId)
    return sendJson(res, 200, { ok: true, stopped: true })
  }

  return false
}

module.exports = {
  handleReposApi,
  handleSessionsApi,
  log
}
