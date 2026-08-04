const { sendJson, readBody } = require("../core/http")
const {
  isValidProjectId,
  loadProjects,
  hideProjectsByTag,
  parseTagLabel,
  addProjectEntry,
  getProjectById,
  updateProjectById,
  removeProjectById,
  validateLocalProjectDir,
  projectPath,
  HIDDEN_TAG
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
const { inferCategoryDir, rememberCategoryDir } = require("../projects/category-dirs")

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

const handleReposApi = async (req, res, pathname, { scheduleRestart }) => {
  if (req.method === "GET" && pathname === "/api/repos") {
    const projects = discoverProjects()
    const enabledProjects = projects.filter((p) => p.enabled)
    const hiddenProjects = projects.filter((p) => !p.enabled)

    const detailedEnabled = await Promise.all(
      enabledProjects.map((p) => getRepoDetails(p.id, { skipGit: true }))
    )
    const detailedHidden = await Promise.all(
      hiddenProjects.map((p) => getRepoDetails(p.id, { skipGit: true }))
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
      listView: prefs.listView,
      listSort: prefs.listSort,
      listFilters: prefs.listFilters,
      recentProjects: prefs.recentProjects,
      projectOrder: prefs.projectOrder,
      locale: prefs.locale,
      sidebarCollapsed: prefs.sidebarCollapsed,
      detailCollapsed: prefs.detailCollapsed,
      activeTag: prefs.activeTag,
      terminalCollapsed: prefs.terminalCollapsed,
      tagIcons: prefs.tagIcons,
      sessions: listAllSessions(),
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
    if (typeof body.detailCollapsed === "boolean") prefs.detailCollapsed = body.detailCollapsed
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
    if (!tag || isUncategorizedKey(tag)) {
      return sendJson(res, 400, { error: "tag required" })
    }
    const cfg = loadConfig()
    const projects = loadProjects()
    const dir = inferCategoryDir(tag, projects, cfg.homePath)
    if (!dir) return sendJson(res, 404, { error: "categoryDirNotFound" })
    return sendJson(res, 200, { tag, dir })
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

      if (!tag || isUncategorizedKey(tag)) {
        return sendJson(res, 400, { error: "category required" })
      }
      if (!name) return sendJson(res, 400, { error: "name required" })
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        return sendJson(res, 400, { error: "invalid name" })
      }

      const cfg = loadConfig()
      const projects = loadProjects()
      const categoryDir = inferCategoryDir(tag, projects, cfg.homePath)
      if (!categoryDir) return sendJson(res, 404, { error: "categoryDirNotFound" })

      const prefs = loadPreferences()
      rememberCategoryDir(prefs, tag, categoryDir)
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

      const project = addProjectEntry({ name, rootPath: targetPath, tags: [tag] })
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
    log("", `Restarting Dock (stopped ${stopped} sessions)…`, "warning")
    sendJson(res, 200, { ok: true, stopped, restarting: true })
    setTimeout(() => scheduleRestart(), 300)
    return true
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
        if (!trimmed || trimmed === UNCATEGORIZED_KEY) {
          const current = getProjectById(projectId)
          const hidden = current?.tags?.includes(HIDDEN_TAG)
          patch.tags = hidden ? [HIDDEN_TAG] : []
        } else {
          patch.tags = [trimmed]
          const current = getProjectById(projectId)
          if (current?.tags?.includes(HIDDEN_TAG)) {
            patch.tags.push(HIDDEN_TAG)
            patch.enabled = false
          }
        }
      }
      if (Array.isArray(body.tags)) patch.tags = body.tags.filter((t) => typeof t === "string")
      if (typeof body.enabled === "boolean") {
        patch.enabled = body.enabled
        if (!body.enabled && !patch.tags) {
          const current = getProjectById(projectId)
          const tags = new Set(current?.tags || [])
          tags.add(HIDDEN_TAG)
          patch.tags = [...tags]
        }
        if (body.enabled && !patch.tags) {
          const current = getProjectById(projectId)
          patch.tags = (current?.tags || []).filter((t) => t !== HIDDEN_TAG)
        }
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
        const updated = updateProjectById(projectId, {
          enabled: false,
          tags: [...new Set([...(project.tags || []), HIDDEN_TAG])]
        })
        broadcast("repo-update", { name: projectId })
        return sendJson(res, 200, { project: updated })
      }

      if (sub === "/show") {
        const updated = updateProjectById(projectId, {
          enabled: true,
          tags: (project.tags || []).filter((t) => t !== HIDDEN_TAG)
        })
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
