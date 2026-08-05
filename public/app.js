const projectList = document.getElementById("project-list")
const detailEmpty = document.getElementById("detail-empty")
const detailContent = document.getElementById("detail-content")
const sidebarNav = document.getElementById("sidebar-nav")
const viewTitle = document.getElementById("view-title")
const viewCount = document.getElementById("view-count")
const searchInput = document.getElementById("search-input")
const sessionTabs = document.getElementById("session-tabs")
const logOutput = document.getElementById("log-output")
const terminalForm = document.getElementById("terminal-form")
const terminalInput = document.getElementById("terminal-input")
const terminalPrompt = document.getElementById("terminal-prompt")
const stopBtn = document.getElementById("stop-btn")
const appEl = document.getElementById("app")

/** @type {Map<string, object>} */
const repos = new Map()
const UNCATEGORIZED_KEY = "__uncategorized__"
let tags = []
let scriptOrder = {}
let listView = "table"
let listSort = "name"
let listFilters = { running: false, dirty: false }
let recentProjects = {}
let projectOrder = {}
let homePath = ""
let activeTag = "__all__"
let showHiddenOnly = false
let selectedRepoId = null
let searchQuery = ""
let sidebarCollapsed = false
let sidebarWidth = 200
const DEFAULT_SIDEBAR_WIDTH = 200
const MIN_SIDEBAR_WIDTH = 160
const SIDEBAR_COLLAPSED_W = 44
const SIDEBAR_COLLAPSE_OVERSHOOT = 60
const SIDEBAR_EXPAND_THRESHOLD = 120
const MAX_SIDEBAR_WIDTH = 320
let detailCollapsed = false
let detailKeepClosed = false
let detailWidth = 420
const DEFAULT_DETAIL_WIDTH = 420
const MIN_DETAIL_WIDTH = Math.round(DEFAULT_DETAIL_WIDTH * 0.9)
const DETAIL_CLOSE_OVERSHOOT = 80
let terminalCollapsed = false
let terminalMaximized = false
let terminalBodyHeight = Number(localStorage.getItem("dock-term-body-h")) || 180
let gitHydrating = false
let gitHydrateToken = 0
let tagIcons = {}
let stripNumbersInJson = false
let detailTabPrefs = {}
let favoriteScripts = {}
/** @type {Map<string, object>} */
const envDataCache = new Map()
/** @type {Set<string>} */
const envRestartPending = new Set()
let detailPanelBound = false
let envIncludeCommented = localStorage.getItem("dock-env-include-commented") === "1"
let detailPrefsHydrated = false
let projectsReloadTimer = null
/** @type {Set<string>} */
const pendingShownIds = new Set()
/** @type {Set<string>} */
const pendingHiddenIds = new Set()

/** @type {Map<string, object>} */
const sessionState = new Map()
let activeSessionId = null

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function jsStr(str) {
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

function showToast(message, { type = "success", duration = 2800 } = {}) {
  const stack = document.getElementById("toast-stack")
  if (!stack) return
  const el = document.createElement("div")
  el.className = `toast toast-${type}`
  el.textContent = message
  stack.appendChild(el)
  setTimeout(() => {
    el.classList.add("toast-out")
    setTimeout(() => el.remove(), 200)
  }, duration)
}

function flashActionButton(btn) {
  if (!btn) return
  btn.classList.add("btn-action-done")
  setTimeout(() => btn.classList.remove("btn-action-done"), 1500)
}

function envIncludeCommentedChecked() {
  const cb = detailContent.querySelector(".env-include-commented-cb")
  return cb ? cb.checked : envIncludeCommented
}

function isDevScript(name) {
  const lower = name.toLowerCase()
  return /^(dev|start(:|$)|start:dev|start:local)/.test(lower) || lower === "serve"
}

function normalizeScriptOrder(repo) {
  const all = repo.scripts || []
  const raw = scriptOrder[repo.id] || repo.scriptOrder
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const run = (raw.run || []).filter((s) => all.includes(s))
    const util = (raw.util || []).filter((s) => all.includes(s))
    const restRun = all.filter((s) => isDevScript(s) && !run.includes(s))
    const restUtil = all.filter((s) => !isDevScript(s) && !util.includes(s))
    return { run: [...run, ...restRun], util: [...util, ...restUtil] }
  }
  if (Array.isArray(raw)) {
    const run = raw.filter((s) => all.includes(s) && isDevScript(s))
    const util = raw.filter((s) => all.includes(s) && !isDevScript(s))
    const restRun = all.filter((s) => isDevScript(s) && !run.includes(s))
    const restUtil = all.filter((s) => !isDevScript(s) && !util.includes(s))
    return { run: [...run, ...restRun], util: [...util, ...restUtil] }
  }
  return {
    run: all.filter(isDevScript),
    util: all.filter((s) => !isDevScript(s))
  }
}

function orderedScriptsForRepo(repo) {
  const { run, util } = normalizeScriptOrder(repo)
  return [...run, ...util]
}

function primaryRunScript(repo) {
  const { run } = normalizeScriptOrder(repo)
  return run[0] || null
}

function getRepoFavorites(repo) {
  return (favoriteScripts[repo.id] || []).filter((s) => (repo.scripts || []).includes(s))
}

function repoHasScripts(repo) {
  return (repo.scripts || []).length > 0
}

function repoHasEnv(repo) {
  if (!repo.isLocal || repo.isMissing || repo.isRemote) return false
  const cached = envDataCache.get(repo.id)
  if (cached) return cached.exists
  return !!repo.hasEnv
}

function getAvailableDetailTabs(repo) {
  const tabs = []
  if (repoHasScripts(repo)) tabs.push("scripts")
  if (repoHasEnv(repo)) tabs.push("env")
  return tabs
}

function projectAvailabilityClass(repo) {
  if (repo.isMissing) return "is-missing"
  if (repo.isRemote) return "is-remote"
  return ""
}

async function removeMissingProject(id) {
  const repo = repos.get(id)
  if (!repo?.isMissing) return
  if (!confirm(t("detail.missing.removeConfirm", { name: repo.name }))) return
  await api(`/api/repos/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (selectedRepoId === id) selectedRepoId = null
  await loadRepos()
  showToast(t("toast.projectDeleted", { name: repo.name }))
}

function isScriptFavorite(repoId, script) {
  return (favoriteScripts[repoId] || []).includes(script)
}

async function toggleFavoriteScript(repoId, script) {
  const repo = repos.get(repoId)
  if (!repo) return
  const current = new Set(favoriteScripts[repoId] || [])
  if (current.has(script)) current.delete(script)
  else current.add(script)
  const scripts = [...current]
  const data = await api(`/api/repos/${encodeURIComponent(repoId)}/favorite-scripts`, {
    method: "PUT",
    body: JSON.stringify({ scripts })
  })
  favoriteScripts = { ...favoriteScripts, [repoId]: data.favoriteScripts || scripts }
  renderProjectList()
  if (selectedRepoId === repoId) renderDetail()
}

function primaryTagOf(repo) {
  if (repo.primaryTag != null && repo.primaryTag !== "") return repo.primaryTag
  return (repo.tags || [])[0] || ""
}

const ctxMenu = document.getElementById("ctx-menu")

const CATEGORY_ICONS = [
  "mdi-folder-outline",
  "mdi-briefcase-outline",
  "mdi-code-tags",
  "mdi-rocket-launch-outline",
  "mdi-flask-outline",
  "mdi-palette-outline",
  "mdi-server",
  "mdi-cloud-outline",
  "mdi-home-outline",
  "mdi-star-outline",
  "mdi-cog-outline",
  "mdi-database-outline"
]

function parseTagDisplay(tag) {
  const match = /^(\d+\.)\s*(.+)$/.exec(String(tag))
  if (match) return { label: match[2] }
  return { label: String(tag) }
}

function getCategoryIcon(tag) {
  if (tag === UNCATEGORIZED_KEY) return "mdi-inbox-outline"
  return tagIcons[tag] || "mdi-folder-outline"
}

function formatTagSidebarHtml(tag) {
  return `<span class="sb-row-label-text">${escapeHtml(parseTagDisplay(tag).label)}</span>`
}

function formatTagHtml(tag, fallback = "") {
  if (!tag || tag === "__all__") return escapeHtml(fallback || t("list.allProjects"))
  if (tag === UNCATEGORIZED_KEY) return escapeHtml(t("sidebar.uncategorized"))
  return escapeHtml(parseTagDisplay(tag).label)
}

function getOrderScope() {
  return activeTag
}

function hasActiveFilters() {
  return listFilters.running || listFilters.dirty || !!searchQuery.trim()
}

function getSortOptions() {
  const options = [
    { value: "name", label: t("sort.name"), icon: "mdi-sort-alphabetical-ascending" },
    { value: "recent", label: t("sort.recent"), icon: "mdi-history" }
  ]
  const scope = getOrderScope()
  if (projectOrder[scope]?.length) {
    options.push({ value: "custom", label: t("sort.custom"), icon: "mdi-drag" })
  }
  return options
}

function sortLabel(value) {
  return getSortOptions().find((o) => o.value === value)?.label || t("sort.name")
}

function openLinkLabel(link) {
  if (!link) return ""
  return link.kind === "swagger" ? t("open.documentation") : t("open.openApp")
}

let ctxMenuCloseHandler = null

function closeContextMenu() {
  if (!ctxMenu) return
  ctxMenu.classList.add("hidden")
  ctxMenu.innerHTML = ""
  if (ctxMenuCloseHandler) {
    document.removeEventListener("click", ctxMenuCloseHandler)
    document.removeEventListener("keydown", ctxMenuCloseHandler)
    ctxMenuCloseHandler = null
  }
}

function positionContextMenu(anchor) {
  const rect = anchor.getBoundingClientRect()
  ctxMenu.style.top = `${rect.bottom + 4}px`
  ctxMenu.style.left = `${Math.min(rect.left, window.innerWidth - ctxMenu.offsetWidth - 8)}px`
}

function openContextMenu(anchor, items) {
  closeContextMenu()
  ctxMenu.innerHTML = items
    .map((item) => {
      if (item.separator) return '<div class="ctx-sep"></div>'
      if (item.submenu) {
        return `<div class="ctx-submenu">
          <button type="button" class="ctx-item ctx-item-submenu">
            <i class="mdi ${item.icon || "mdi-folder-move-outline"}"></i>${escapeHtml(item.label)}<i class="mdi mdi-chevron-right ctx-arrow"></i>
          </button>
          <div class="ctx-submenu-panel">${item.submenu
            .map(
              (sub) =>
                `<button type="button" class="ctx-item" data-action="${escapeHtml(sub.id)}">${sub.icon ? `<i class="mdi ${sub.icon}"></i>` : ""}${escapeHtml(sub.label)}</button>`
            )
            .join("")}</div>
        </div>`
      }
      return `<button type="button" class="ctx-item" data-action="${escapeHtml(item.id)}">${item.icon ? `<i class="mdi ${item.icon}"></i>` : ""}${escapeHtml(item.label)}</button>`
    })
    .join("")

  ctxMenu.classList.remove("hidden")
  positionContextMenu(anchor)
  bindSubmenuHover()

  ctxMenu.querySelectorAll(".ctx-item[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation()
      const flat = items.flatMap((i) => (i.submenu ? i.submenu : [i]))
      const item = flat.find((i) => i.id === btn.dataset.action)
      closeContextMenu()
      await item?.action?.()
    })
  })

  setTimeout(() => {
    ctxMenuCloseHandler = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return
      if (e.type === "click" && ctxMenu.contains(e.target)) return
      closeContextMenu()
    }
    document.addEventListener("click", ctxMenuCloseHandler)
    document.addEventListener("keydown", ctxMenuCloseHandler)
  }, 0)
}

function bindSubmenuHover() {
  ctxMenu.querySelectorAll(".ctx-submenu").forEach((sub) => {
    const panel = sub.querySelector(".ctx-submenu-panel")
    if (!panel) return
    let timer
    const open = () => {
      clearTimeout(timer)
      ctxMenu.querySelectorAll(".ctx-submenu-panel.open").forEach((p) => {
        if (p !== panel) p.classList.remove("open")
      })
      panel.classList.add("open")
    }
    const close = () => {
      timer = setTimeout(() => panel.classList.remove("open"), 180)
    }
    sub.addEventListener("mouseenter", open)
    sub.addEventListener("mouseleave", close)
    panel.addEventListener("mouseenter", open)
    panel.addEventListener("mouseleave", close)
  })
}

function openPickerMenu(anchor, items, onSelect) {
  closeContextMenu()
  ctxMenu.innerHTML = items
    .map((item) => {
      const active = item.active ? " active" : ""
      return `<button type="button" class="ctx-item ctx-item-compact${active}" data-value="${escapeHtml(item.value)}">${item.icon ? `<i class="mdi ${item.icon}"></i>` : ""}${escapeHtml(item.label)}</button>`
    })
    .join("")

  ctxMenu.classList.remove("hidden")
  positionContextMenu(anchor)

  ctxMenu.querySelectorAll(".ctx-item[data-value]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      const value = btn.dataset.value
      closeContextMenu()
      onSelect(value)
    })
  })

  setTimeout(() => {
    ctxMenuCloseHandler = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return
      if (e.type === "click" && ctxMenu.contains(e.target)) return
      closeContextMenu()
    }
    document.addEventListener("click", ctxMenuCloseHandler)
    document.addEventListener("keydown", ctxMenuCloseHandler)
  }, 0)
}

function openIconPicker(tag, anchor) {
  closeContextMenu()
  ctxMenu.innerHTML = `<div class="ctx-icon-grid">${CATEGORY_ICONS.map(
    (icon) =>
      `<button type="button" class="ctx-icon-btn ${getCategoryIcon(tag) === icon ? "active" : ""}" data-icon="${icon}"><i class="mdi ${icon}"></i></button>`
  ).join("")}</div>`
  ctxMenu.classList.remove("hidden")
  positionContextMenu(anchor)

  ctxMenu.querySelectorAll(".ctx-icon-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation()
      closeContextMenu()
      const data = await api("/api/tags/icon", {
        method: "PUT",
        body: JSON.stringify({ tag, icon: btn.dataset.icon })
      })
      tagIcons = data.tagIcons || tagIcons
      renderSidebar()
    })
  })

  setTimeout(() => {
    ctxMenuCloseHandler = (e) => {
      if (e.type === "keydown" && e.key !== "Escape") return
      if (e.type === "click" && ctxMenu.contains(e.target)) return
      closeContextMenu()
    }
    document.addEventListener("click", ctxMenuCloseHandler)
    document.addEventListener("keydown", ctxMenuCloseHandler)
  }, 0)
}

function getHiddenRepos() {
  return [...repos.values()].filter((r) => r.enabled === false)
}

function getVisibleRepos() {
  return [...repos.values()].filter((r) => r.enabled !== false)
}

function getActiveRepoList() {
  if (showHiddenOnly) return getHiddenRepos()
  return getVisibleRepos()
}

function filterRepos(list) {
  let result = list
  if (!showHiddenOnly && activeTag !== "__all__") {
    if (activeTag === UNCATEGORIZED_KEY) {
      result = result.filter((r) => !primaryTagOf(r))
    } else {
      result = result.filter((r) => primaryTagOf(r) === activeTag)
    }
  }
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase()
    result = result.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || (r.path || r.rootPath || "").toLowerCase().includes(q)
    )
  }
  if (listFilters.running) result = result.filter((r) => r.isRunning)
  if (listFilters.dirty) result = result.filter((r) => r.isDirty)
  if (listSort === "recent") {
    return [...result].sort((a, b) => (recentProjects[b.id] || 0) - (recentProjects[a.id] || 0))
  }
  if (listSort === "custom") {
    const scope = getOrderScope()
    const order = projectOrder[scope]
    if (order?.length) {
      const index = new Map(order.map((id, i) => [id, i]))
      return [...result].sort((a, b) => {
        const ia = index.has(a.id) ? index.get(a.id) : Number.MAX_SAFE_INTEGER
        const ib = index.has(b.id) ? index.get(b.id) : Number.MAX_SAFE_INTEGER
        if (ia !== ib) return ia - ib
        return a.name.localeCompare(b.name)
      })
    }
  }
  return [...result].sort((a, b) => a.name.localeCompare(b.name))
}

async function saveProjectOrder(ids) {
  const scope = getOrderScope()
  projectOrder = { ...projectOrder, [scope]: ids }
  listSort = "custom"
  await api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ projectOrder, listSort: "custom" })
  }).catch(() => {})
}

function statusMeta(repo) {
  const running = repo.isRunning
  const dirty = repo.isDirty
  const statusClass = running ? "running" : dirty ? "dirty" : ""
  const statusTitle = running
    ? t("status.running")
    : dirty
      ? t("status.dirty")
      : repo.hasGit
        ? t("status.clean")
        : t("status.noGit")
  return { statusClass, statusTitle }
}

let draggedTag = null
let sidebarDnDBound = false

function initSidebarDnD() {
  if (sidebarDnDBound) return
  sidebarDnDBound = true

  sidebarNav.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".nav-drag-handle")
    if (!handle || sidebarCollapsed) return
    const item = handle.closest(".nav-item[data-tag]")
    if (
      !item?.dataset.tag ||
      item.dataset.tag === UNCATEGORIZED_KEY
    )
      return
    draggedTag = item.dataset.tag
    item.classList.add("dragging")
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", draggedTag)
  })

  sidebarNav.addEventListener("dragend", (e) => {
    const item = e.target.closest(".nav-item")
    item?.classList.remove("dragging")
    sidebarNav
      .querySelectorAll(".nav-item.drag-over")
      .forEach((el) => el.classList.remove("drag-over"))
    draggedTag = null
  })

  sidebarNav.addEventListener("dragover", (e) => {
    const item = e.target.closest(".nav-item[data-tag]")
    if (
      !item ||
      item.dataset.tag === "__all__" ||
      item.dataset.tag === UNCATEGORIZED_KEY
    )
      return
    if (!draggedTag || item.dataset.tag === draggedTag) return
    e.preventDefault()
    sidebarNav.querySelectorAll(".nav-item.drag-over").forEach((el) => {
      if (el !== item) el.classList.remove("drag-over")
    })
    item.classList.add("drag-over")
  })

  sidebarNav.addEventListener("dragleave", (e) => {
    const item = e.target.closest(".nav-item")
    if (item && !item.contains(e.relatedTarget)) item.classList.remove("drag-over")
  })

  sidebarNav.addEventListener("drop", async (e) => {
    const item = e.target.closest(".nav-item[data-tag]")
    if (
      !item ||
      item.dataset.tag === "__all__" ||
      item.dataset.tag === UNCATEGORIZED_KEY
    )
      return
    e.preventDefault()
    item.classList.remove("drag-over")
    const targetTag = item.dataset.tag
    if (!draggedTag || !targetTag || draggedTag === targetTag) return
    const order = [...tags]
    const from = order.indexOf(draggedTag)
    const to = order.indexOf(targetTag)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, draggedTag)
    try {
      const data = await api("/api/tags/order", {
        method: "PUT",
        body: JSON.stringify({ tags: order })
      })
      tags = data.tags || order
      if (data.tagIcons) tagIcons = data.tagIcons
      await loadRepos()
    } catch {
      renderSidebar()
    }
  })
}

function selectSidebarTag(tag) {
  showHiddenOnly = false
  activeTag = tag
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({
      activeTag: activeTag === "__all__" ? null : activeTag
    })
  }).catch(() => {})
  renderAll()
  hydrateGitForVisible()
}

async function hideCategory(tag) {
  const count = getVisibleRepos().filter((r) => primaryTagOf(r) === tag).length
  if (!count) return
  if (!confirm(t("context.hideCategoryConfirm", { count }))) return
  await api("/api/tags/hide", { method: "POST", body: JSON.stringify({ tag }) })
  if (activeTag === tag) activeTag = "__all__"
  await loadRepos()
}

async function renameCategory(tag, currentLabel) {
  const name = prompt(t("context.renameCategoryPrompt"), currentLabel)
  if (!name?.trim() || name.trim() === currentLabel) return
  const data = await api("/api/tags/rename", {
    method: "PUT",
    body: JSON.stringify({ tag, name: name.trim() })
  })
  if (activeTag === tag) activeTag = data.tag
  tags = data.tags || tags
  if (data.tagIcons) tagIcons = data.tagIcons
  await loadRepos()
}

async function cycleCategoryIcon(tag) {
  const current = getCategoryIcon(tag)
  const idx = CATEGORY_ICONS.indexOf(current)
  const next = CATEGORY_ICONS[(idx + 1) % CATEGORY_ICONS.length]
  const data = await api("/api/tags/icon", {
    method: "PUT",
    body: JSON.stringify({ tag, icon: next })
  })
  tagIcons = data.tagIcons || tagIcons
  renderSidebar()
}

function openCategoryMenu(tag, anchor) {
  if (tag === UNCATEGORIZED_KEY) return
  const { label } = parseTagDisplay(tag)
  openContextMenu(anchor, [
    {
      id: "hide-cat",
      label: t("context.hideCategory"),
      icon: "mdi-eye-off-outline",
      action: () => hideCategory(tag)
    },
    {
      id: "rename-cat",
      label: t("context.renameCategory"),
      icon: "mdi-pencil-outline",
      action: () => renameCategory(tag, label)
    },
    {
      id: "icon-cat",
      label: t("context.changeIcon"),
      icon: "mdi-shape-outline",
      action: () => openIconPicker(tag, anchor)
    }
  ])
}

async function moveProjectToCategory(id, tag) {
  const repo = repos.get(id)
  const data = await api(`/api/repos/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ tag })
  })
  const existing = repos.get(id)
  if (existing && data.repo) {
    repos.set(id, { ...existing, ...data.repo })
  }
  renderProjectList()
  if (selectedRepoId === id) renderDetail()
  const categoryLabel =
    !tag || tag === UNCATEGORIZED_KEY
      ? t("sidebar.uncategorized")
      : parseTagDisplay(tag).label || tag
  showToast(t("toast.projectMoved", { name: repo?.name || id, category: categoryLabel }))
}

function openProjectMenu(id, anchor) {
  const repo = repos.get(id)
  if (!repo) return
  const isHidden = repo.enabled === false
  const currentTag = primaryTagOf(repo)
  const moveTargets = tags.filter((t) => t !== currentTag && t !== UNCATEGORIZED_KEY)
  const showUncategorized = !!currentTag

  const items = []
  if (isHidden) {
    items.push({
      id: "show",
      label: t("context.restore"),
      icon: "mdi-eye-outline",
      action: () => showRepo(id)
    })
  } else {
    items.push({
      id: "hide",
      label: t("context.hide"),
      icon: "mdi-eye-off-outline",
      action: () => hideRepo(id)
    })
  }
  if (moveTargets.length || showUncategorized) {
    const submenu = moveTargets.map((t, i) => ({
      id: `move-${i}`,
      label: parseTagDisplay(t).label || t,
      icon: getCategoryIcon(t),
      action: () => moveProjectToCategory(id, t)
    }))
    if (showUncategorized) {
      submenu.unshift({
        id: "move-uncat",
        label: t("context.moveUncategorized"),
        icon: getCategoryIcon(UNCATEGORIZED_KEY),
        action: () => moveProjectToCategory(id, "")
      })
    }
    items.push({
      id: "move",
      label: t("context.moveTo"),
      icon: "mdi-folder-move-outline",
      submenu
    })
  }
  items.push({
    id: "delete",
    label: t("context.delete"),
    icon: "mdi-delete-outline",
    action: () => unregisterRepo(id)
  })
  openContextMenu(anchor, items)
}

function renderSidebar() {
  const allActive = activeTag === "__all__" ? "active" : ""
  const allBtn = `<button type="button" class="sb-row nav-item-static ${allActive}" data-tag="__all__">
      <i class="mdi mdi-folder-multiple-outline sb-row-icon"></i>
      <span class="sb-row-label">${t("sidebar.allProjects")}</span>
    </button>`

  const tagItems = tags
    .map((tag) => {
      const icon = getCategoryIcon(tag)
      const labelHtml =
        tag === UNCATEGORIZED_KEY
          ? `<span class="sb-row-label-text">${escapeHtml(t("sidebar.uncategorized"))}</span>`
          : formatTagSidebarHtml(tag)
      const dragAttr = sidebarCollapsed || tag === UNCATEGORIZED_KEY ? "" : 'draggable="true"'
      const menuBtn =
        tag === UNCATEGORIZED_KEY
          ? ""
          : `<button type="button" class="sb-row-menu nav-item-menu" data-tag="${escapeHtml(tag)}" title="${escapeHtml(t("sidebar.actions"))}">
        <i class="mdi mdi-dots-vertical"></i>
      </button>`
      return `<div class="sb-row nav-item ${activeTag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}" role="button" tabindex="0">
        <span class="sb-drag nav-drag-handle" ${dragAttr} title="${escapeHtml(t("sidebar.drag"))}"><i class="mdi mdi-drag-vertical"></i></span>
        <i class="mdi ${icon} sb-row-icon"></i>
        <span class="sb-row-label">${labelHtml}</span>
        ${menuBtn}
      </div>`
    })
    .join("")

  const hiddenBtn = ""

  sidebarNav.innerHTML = allBtn + tagItems + hiddenBtn

  sidebarNav.querySelectorAll(".nav-item[data-tag], .nav-item-static").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest(".nav-item-menu") || e.target.closest(".nav-drag-handle")) return
      if (item.dataset.tag) selectSidebarTag(item.dataset.tag)
    })
    item.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      if (item.dataset.tag) selectSidebarTag(item.dataset.tag)
    })
  })

  sidebarNav.querySelectorAll(".nav-item-menu").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      openCategoryMenu(btn.dataset.tag, btn)
    })
  })
  updateSidebarFooter()
}

function updateSidebarFooter() {
  document.getElementById("hidden-btn")?.classList.toggle("active", showHiddenOnly)
}

function renderProjectList() {
  const list = filterRepos(getActiveRepoList())
  if (showHiddenOnly) {
    viewTitle.textContent = t("sidebar.hidden")
    viewCount.textContent = t("list.hiddenCount", { count: list.length })
  } else if (activeTag === UNCATEGORIZED_KEY) {
    viewTitle.textContent = t("sidebar.uncategorized")
    viewCount.textContent = t("list.projectsCount", { count: list.length })
  } else if (activeTag === "__all__") {
    viewTitle.textContent = t("list.allProjects")
    viewCount.textContent = t("list.projectsCount", { count: list.length })
  } else {
    viewTitle.innerHTML = formatTagHtml(activeTag)
    viewCount.textContent = t("list.projectsCount", { count: list.length })
  }

  const panel = document.querySelector(".project-list-panel")
  const tableWrap = document.getElementById("project-table-wrap")
  const listHeader = document.querySelector(".list-header")
  panel?.classList.toggle("cards-view", listView === "cards")
  tableWrap?.classList.toggle("cards-view", listView === "cards")
  listHeader?.classList.toggle("hidden", listView === "cards")

  const sortLabelEl = document.getElementById("list-sort-label")
  if (sortLabelEl) sortLabelEl.textContent = sortLabel(listSort)
  const viewIcon = document.getElementById("list-view-icon")
  if (viewIcon) {
    viewIcon.className =
      listView === "cards" ? "mdi mdi-view-list-outline" : "mdi mdi-view-grid-outline"
  }
  document.getElementById("filter-running")?.classList.toggle("active", listFilters.running)
  document.getElementById("filter-dirty")?.classList.toggle("active", listFilters.dirty)
  document.getElementById("filter-clear")?.classList.toggle("hidden", !hasActiveFilters())
  const detailIcon = document.getElementById("detail-toggle-icon")
  const detailHidden = !selectedRepoId || detailCollapsed
  if (detailIcon) {
    detailIcon.className = detailHidden ? "mdi mdi-dock-left" : "mdi mdi-dock-right"
  }
  document
    .getElementById("detail-toggle")
    ?.setAttribute("title", detailHidden ? t("list.showDetail") : t("list.hideDetail"))

  if (!list.length) {
    projectList.className = "project-list"
    projectList.innerHTML = `<div class="empty-state">${escapeHtml(t("list.empty"))}</div>`
    return
  }

  if (listView === "cards") {
    projectList.className = "project-list project-grid"
    projectList.innerHTML = list.map((repo) => renderProjectCard(repo)).join("")
  } else {
    projectList.className = "project-list"
    projectList.innerHTML = list.map((repo) => renderProjectRow(repo)).join("")
  }

  projectList.querySelectorAll("[data-id]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (
        e.target.closest(".project-card-actions") ||
        e.target.closest(".project-card-favorites") ||
        e.target.closest(".col-actions") ||
        e.target.closest(".project-drag")
      )
        return
      selectRepo(row.dataset.id)
    })
  })

  projectList.querySelectorAll(".card-script-play").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      runScript(btn.dataset.repo, btn.dataset.script)
    })
  })
  projectList.querySelectorAll(".card-script-pause").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      pauseScript(btn.dataset.repo, btn.dataset.script)
    })
  })
  projectList.querySelectorAll(".card-script-restart").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      restartScript(btn.dataset.repo, btn.dataset.script)
    })
  })
  projectList.querySelectorAll(".card-fav-chip").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      runScript(btn.dataset.repo, btn.dataset.script)
    })
  })
  bindProjectListDnD()
}

function renderProjectRow(repo) {
  const selected = repo.id === selectedRepoId ? "selected" : ""
  const avail = projectAvailabilityClass(repo)
  const { statusClass, statusTitle } = statusMeta(repo)
  const branch =
    gitHydrating && repo.hasGit && !repo.branch ? "…" : repo.branch || (repo.hasGit ? "—" : "—")
  const dirtyBadge =
    repo.isDirty && repo.dirtyCount
      ? `<span class="branch-dirty" title="${escapeHtml(t("list.changes"))}">${repo.dirtyCount}</span>`
      : ""
  const pathLabel = repo.isRemote
    ? `<span class="project-path project-path-remote"><i class="mdi mdi-cloud-outline"></i> ${escapeHtml(repo.rootPath)}</span>`
    : repo.isMissing
      ? `<span class="project-path project-path-missing"><i class="mdi mdi-folder-off-outline"></i> ${escapeHtml(repo.rootPath)}</span>`
      : `<div class="project-path">${escapeHtml(repo.path || repo.rootPath || "")}</div>`
  const branchCell =
    repo.isMissing || repo.isRemote
      ? `<span class="branch-meta-label">${escapeHtml(repo.isRemote ? t("detail.remote.short") : t("detail.missing.short"))}</span>`
      : `<i class="mdi mdi-source-branch branch-icon"></i><span class="branch-text">${escapeHtml(branch)}</span>${dirtyBadge}`
  const favs = getRepoFavorites(repo)
  const favHtml = favs.length
    ? `<div class="row-fav-chips">${favs
        .map(
          (s) =>
            `<button type="button" class="card-fav-chip" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(s)}" title="${escapeHtml(t("scripts.playNamed", { name: s }))}">${escapeHtml(s)}</button>`
        )
        .join("")}</div>`
    : ""
  return `<div class="project-row ${selected} ${avail}" data-id="${escapeHtml(repo.id)}">
    <div class="col-name">
      <div class="project-name-row">
        <span class="project-drag" draggable="true" title="${escapeHtml(t("list.dragProject"))}"><i class="mdi mdi-drag-vertical"></i></span>
        <span class="status-dot ${statusClass}" title="${escapeHtml(statusTitle)}"></span>
        <span class="project-name">${escapeHtml(repo.name)}</span>
      </div>
      ${pathLabel}
    </div>
    <div class="branch-cell">${branchCell}</div>
    <div class="col-actions">
      ${renderCardScriptActions(repo, "row-actions")}
      ${favHtml}
    </div>
  </div>`
}

function renderCardScriptActions(repo, extraClass = "") {
  const script = primaryRunScript(repo)
  if (!script || repo.isMissing) return ""
  const running = isScriptRunning(repo.id, script)
  const cls = extraClass ? ` ${extraClass}` : ""
  if (running) {
    return `<div class="project-card-actions${cls}">
      <button type="button" class="card-script-btn card-script-restart" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(script)}" title="${escapeHtml(t("scripts.restartNamed", { name: script }))}"><i class="mdi mdi-restart"></i></button>
      <button type="button" class="card-script-btn card-script-pause" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(script)}" title="${escapeHtml(t("scripts.stop"))}"><i class="mdi mdi-pause"></i></button>
    </div>`
  }
  return `<div class="project-card-actions${cls}">
    <button type="button" class="card-script-btn card-script-play" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(script)}" title="${escapeHtml(t("scripts.playNamed", { name: script }))}"><i class="mdi mdi-play"></i></button>
  </div>`
}

function renderCardFavorites(repo) {
  const favs = getRepoFavorites(repo)
  if (!favs.length) return ""
  return `<div class="project-card-favorites">${favs
    .map(
      (s) =>
        `<button type="button" class="card-fav-chip" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(s)}" title="${escapeHtml(t("scripts.playNamed", { name: s }))}">${escapeHtml(s)}</button>`
    )
    .join("")}</div>`
}

function renderProjectCard(repo) {
  const selected = repo.id === selectedRepoId ? "selected" : ""
  const avail = projectAvailabilityClass(repo)
  const { statusClass, statusTitle } = statusMeta(repo)
  const branch =
    gitHydrating && repo.hasGit && !repo.branch ? "…" : repo.branch || (repo.hasGit ? "—" : "—")
  const script = primaryRunScript(repo)
  const scriptHint = script && !repo.isMissing && !repo.isRemote ? `<span class="project-card-script">${escapeHtml(script)}</span>` : ""
  const branchRow =
    repo.isMissing || repo.isRemote
      ? `<div class="project-card-branch project-card-meta"><i class="mdi ${repo.isRemote ? "mdi-cloud-outline" : "mdi-folder-off-outline"}"></i> ${escapeHtml(repo.isRemote ? t("detail.remote.short") : t("detail.missing.short"))}</div>`
      : `<div class="project-card-branch"><i class="mdi mdi-source-branch"></i> ${escapeHtml(branch)}${scriptHint}</div>`
  const pathHtml = repo.isRemote
    ? `<div class="project-path project-path-remote">${escapeHtml(repo.rootPath)}</div>`
    : repo.isMissing
      ? `<div class="project-path project-path-missing">${escapeHtml(repo.rootPath)}</div>`
      : `<div class="project-path">${escapeHtml(repo.path || repo.rootPath || "")}</div>`
  return `<div class="project-card ${selected} ${avail}" data-id="${escapeHtml(repo.id)}">
    <div class="project-card-head">
      <span class="project-drag" draggable="true" title="${escapeHtml(t("list.dragProject"))}"><i class="mdi mdi-drag-vertical"></i></span>
      <div class="project-card-main">
        <div class="project-card-top">
          <span class="status-dot ${statusClass}" title="${escapeHtml(statusTitle)}"></span>
          <span class="project-name">${escapeHtml(repo.name)}</span>
        </div>
        ${pathHtml}
        ${branchRow}
      </div>
      ${renderCardScriptActions(repo)}
    </div>
    ${renderCardFavorites(repo)}
  </div>`
}

function pmRunLabel(repo, script) {
  const pm = repo.packageManager || "npm"
  if (pm === "pnpm") return `pnpm run ${script}`
  if (pm === "yarn") return `yarn ${script}`
  return `npm run ${script}`
}

function getScriptSession(repoId, script, { aliveOnly = false } = {}) {
  const matches = [...sessionState.values()].filter((s) => s.repo === repoId && s.label === script)
  const alive = matches.find((s) => s.alive)
  if (aliveOnly) return alive || null
  return alive || matches[0] || null
}

function isScriptRunning(repoId, script) {
  return Boolean(getScriptSession(repoId, script, { aliveOnly: true }))
}

function updateScriptRow(repoId, script) {
  if (selectedRepoId !== repoId) return
  const row = detailContent.querySelector(`.script-row[data-script="${CSS.escape(script)}"]`)
  if (!row) return
  const repo = repos.get(repoId)
  if (!repo) return
  const { run, util } = normalizeScriptOrder(repo)
  const group = run.includes(script) ? "run" : "util"
  const tmp = document.createElement("div")
  tmp.innerHTML = renderScriptRow(repo, script, group)
  const next = tmp.firstElementChild
  if (next) row.replaceWith(next)
}

function updateScriptRowsForRepo(repoId) {
  if (selectedRepoId !== repoId) return
  const repo = repos.get(repoId)
  if (!repo) return
  if (!detailContent.querySelector(".scripts-panel")) {
    renderDetail()
    return
  }
  const { run, util } = normalizeScriptOrder(repo)
  for (const s of run) updateScriptRow(repoId, s)
  for (const s of util) updateScriptRow(repoId, s)
}

function renderScriptRow(repo, script, group) {
  const id = jsStr(repo.id)
  const s = jsStr(script)
  const running = isScriptRunning(repo.id, script)
  const isFav = isScriptFavorite(repo.id, script)
  const favIcon = isFav ? "mdi-star" : "mdi-star-outline"
  const favTitle = isFav ? t("scripts.unfavorite") : t("scripts.favorite")

  const actions = running
    ? `<button type="button" class="script-action script-restart" onclick="restartScript('${id}', '${s}')" title="${escapeHtml(t("scripts.restart"))}"><i class="mdi mdi-restart"></i></button>
       <button type="button" class="script-action script-pause" onclick="pauseScript('${id}', '${s}')" title="${escapeHtml(t("scripts.stop"))}"><i class="mdi mdi-pause"></i></button>`
    : `<button type="button" class="script-action script-play" onclick="runScript('${id}', '${s}')" title="${escapeHtml(t("scripts.play"))}"><i class="mdi mdi-play"></i></button>`

  return `<div class="script-row ${running ? "running" : ""}" data-script="${escapeHtml(script)}" data-group="${escapeHtml(group)}" draggable="true">
    <span class="script-drag" title="${escapeHtml(t("scripts.drag"))}"><i class="mdi mdi-drag-vertical"></i></span>
    <div class="script-row-body">
      <span class="script-name">${escapeHtml(script)}</span>
      <span class="script-cmd">${escapeHtml(pmRunLabel(repo, script))}</span>
    </div>
    <button type="button" class="script-fav ${isFav ? "is-fav" : ""}" data-repo="${escapeHtml(repo.id)}" data-script="${escapeHtml(script)}" title="${escapeHtml(favTitle)}"><i class="mdi ${favIcon}"></i></button>
    <div class="script-actions">${actions}</div>
  </div>`
}

let draggedProjectId = null
let projectListDnDBound = false

function bindProjectListDnD() {
  if (projectListDnDBound) return
  projectListDnDBound = true

  projectList.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".project-drag")
    if (!handle) return
    const item = handle.closest("[data-id]")
    if (!item?.dataset.id) return
    draggedProjectId = item.dataset.id
    item.classList.add("dragging")
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", draggedProjectId)
  })

  projectList.addEventListener("dragend", (e) => {
    const item = e.target.closest("[data-id]")
    item?.classList.remove("dragging")
    projectList.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"))
    draggedProjectId = null
  })

  projectList.addEventListener("dragover", (e) => {
    const item = e.target.closest("[data-id]")
    if (!item?.dataset.id || !draggedProjectId || item.dataset.id === draggedProjectId) return
    e.preventDefault()
    projectList.querySelectorAll(".drag-over").forEach((el) => {
      if (el !== item) el.classList.remove("drag-over")
    })
    item.classList.add("drag-over")
  })

  projectList.addEventListener("dragleave", (e) => {
    const item = e.target.closest("[data-id]")
    if (item && !item.contains(e.relatedTarget)) item.classList.remove("drag-over")
  })

  projectList.addEventListener("drop", async (e) => {
    const item = e.target.closest("[data-id]")
    if (!item?.dataset.id || !draggedProjectId) return
    e.preventDefault()
    item.classList.remove("drag-over")
    const targetId = item.dataset.id
    if (!targetId || targetId === draggedProjectId) return

    const list = filterRepos(getActiveRepoList())
    const ids = list.map((r) => r.id)
    const from = ids.indexOf(draggedProjectId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    ids.splice(from, 1)
    ids.splice(to, 0, draggedProjectId)
    await saveProjectOrder(ids)
    renderProjectList()
  })
}

function renderScripts(repo) {
  const { run, util } = normalizeScriptOrder(repo)
  if (!run.length && !util.length) {
    return `<p class="scripts-empty">${escapeHtml(t("scripts.empty"))}</p>`
  }

  const total = run.length + util.length
  let html = `<div class="scripts-panel" data-repo-id="${escapeHtml(repo.id)}">
    <div class="scripts-toolbar">
      <span class="scripts-toolbar-label">${escapeHtml(t("scripts.count", { count: total }))}</span>
    </div>`

  if (run.length) {
    html += `<div class="script-group" data-group="run"><div class="script-group-label">${escapeHtml(t("scripts.run"))}</div><div class="scripts-list">`
    for (const s of run) html += renderScriptRow(repo, s, "run")
    html += `</div></div>`
  }
  if (util.length) {
    html += `<div class="script-group" data-group="util"><div class="script-group-label">${escapeHtml(t("scripts.utilities"))}</div><div class="scripts-list">`
    for (const s of util) html += renderScriptRow(repo, s, "util")
    html += `</div></div>`
  }

  html += `</div>`
  return html
}

function getActiveDetailTab(repoId) {
  return detailTabPrefs[repoId] === "env" ? "env" : "scripts"
}

async function setActiveDetailTab(repoId, tab) {
  detailTabPrefs = { ...detailTabPrefs, [repoId]: tab }
  await api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ detailTab: detailTabPrefs })
  }).catch(() => {})
}

function getAliveSessionsForRepo(repoId) {
  return [...sessionState.values()].filter((s) => s.repo === repoId && s.alive)
}

function renderEnvRestartBanner(repoId) {
  if (!envRestartPending.has(repoId)) return ""
  const alive = getAliveSessionsForRepo(repoId)
  if (!alive.length) {
    envRestartPending.delete(repoId)
    return ""
  }
  return `<div class="env-restart-banner" data-repo-id="${escapeHtml(repoId)}">
    <span class="env-restart-text"><i class="mdi mdi-alert-outline"></i> ${escapeHtml(t("env.restart.title"))}</span>
    <div class="env-restart-actions">
      <button type="button" class="btn btn-sm btn-primary env-restart-btn" data-repo="${escapeHtml(repoId)}">${escapeHtml(t("env.restart.action"))}</button>
      <button type="button" class="btn btn-sm env-restart-dismiss" data-repo="${escapeHtml(repoId)}">${escapeHtml(t("env.restart.dismiss"))}</button>
    </div>
  </div>`
}

function renderEnvEmpty(repoId) {
  return `<div class="env-panel env-empty-state">
    <p>${escapeHtml(t("env.empty"))}</p>
    <button type="button" class="btn btn-primary env-create-btn" data-repo="${escapeHtml(repoId)}">${escapeHtml(t("env.create"))}</button>
  </div>`
}

function renderEnvVarGroup(entry) {
  const key = entry.key
  const variants = entry.variants || []
  const multi = variants.length > 1

  const variantsHtml = variants
    .map((v, i) => {
      const activeClass = v.active ? "active" : "dimmed"
      const radio = multi
        ? `<button type="button" class="env-variant-radio ${v.active ? "is-active" : ""}" data-key="${escapeHtml(key)}" data-index="${i}" title="${escapeHtml(t("env.selectVariant"))}"><i class="mdi ${v.active ? "mdi-radiobox-marked" : "mdi-radiobox-blank"}"></i></button>`
        : ""
      return `<div class="env-variant ${activeClass}" data-key="${escapeHtml(key)}" data-index="${i}">
      ${radio}
      <input type="text" class="env-value-input" data-key="${escapeHtml(key)}" data-index="${i}" value="${escapeHtml(v.value)}" spellcheck="false" />
    </div>`
    })
    .join("")

  const addVariantBtn = `<button type="button" class="env-add-variant btn btn-sm" data-key="${escapeHtml(key)}"><i class="mdi mdi-plus"></i> ${escapeHtml(t("env.addVariant"))}</button>`

  if (multi) {
    return `<div class="env-var-group" data-key="${escapeHtml(key)}">
      <div class="env-var-key">${escapeHtml(key)}</div>
      <div class="env-variants">${variantsHtml}</div>
      ${addVariantBtn}
    </div>`
  }

  return `<div class="env-var-group env-var-single" data-key="${escapeHtml(key)}">
    <label class="env-var-key-label">${escapeHtml(key)}</label>
    <input type="text" class="env-value-input env-single-value" data-key="${escapeHtml(key)}" data-index="0" value="${escapeHtml(variants[0]?.value || "")}" spellcheck="false" />
    ${addVariantBtn}
  </div>`
}

function renderEnvEditor(repoId, data) {
  const vars = (data.entries || []).filter((e) => e.type === "var")
  const varsHtml = vars.length
    ? vars.map((e) => renderEnvVarGroup(e)).join("")
    : `<p class="env-no-vars">${escapeHtml(t("env.noVariables"))}</p>`

  return `<div class="env-panel" data-repo-id="${escapeHtml(repoId)}">
    ${renderEnvRestartBanner(repoId)}
    <div class="env-toolbar">
      <div class="env-toolbar-actions">
        <button type="button" class="btn btn-sm env-copy-btn" data-repo="${escapeHtml(repoId)}"><i class="mdi mdi-content-copy"></i> ${escapeHtml(t("env.copyActive"))}</button>
        <button type="button" class="btn btn-sm env-example-btn" data-repo="${escapeHtml(repoId)}"><i class="mdi mdi-file-document-outline"></i> ${escapeHtml(t("env.generateExample"))}</button>
      </div>
      <label class="env-toolbar-option">
        <input type="checkbox" class="env-include-commented-cb" ${envIncludeCommented ? "checked" : ""} />
        <span>${escapeHtml(t("env.includeCommented"))}</span>
      </label>
    </div>
    <div class="env-editor-list">${varsHtml}</div>
    <div class="env-add-variable">
      <input type="text" class="env-new-key" placeholder="${escapeHtml(t("env.keyPlaceholder"))}" spellcheck="false" />
      <input type="text" class="env-new-value" placeholder="${escapeHtml(t("env.valuePlaceholder"))}" spellcheck="false" />
      <button type="button" class="btn btn-sm btn-primary env-add-variable-btn"><i class="mdi mdi-plus"></i> ${escapeHtml(t("env.addVariable"))}</button>
    </div>
  </div>`
}

function renderEnvPanel(repo) {
  const cached = envDataCache.get(repo.id)
  if (!cached) {
    return `<div class="env-panel env-loading"><p>${escapeHtml(t("list.loading"))}</p></div>`
  }
  if (!cached.exists) return renderEnvEmpty(repo.id)
  return renderEnvEditor(repo.id, cached)
}

function renderDetailStatusBanner(repo) {
  if (repo.isMissing) {
    return `<div class="detail-status-banner detail-missing">
      <div class="detail-status-icon"><i class="mdi mdi-folder-off-outline"></i></div>
      <div class="detail-status-body">
        <strong>${escapeHtml(t("detail.missing.title"))}</strong>
        <p>${escapeHtml(t("detail.missing.body"))}</p>
        <code>${escapeHtml(repo.rootPath)}</code>
      </div>
      <button type="button" class="btn btn-sm btn-primary" onclick="removeMissingProject('${jsStr(repo.id)}')">${escapeHtml(t("detail.missing.remove"))}</button>
    </div>`
  }
  if (repo.isRemote) {
    return `<div class="detail-status-banner detail-remote">
      <div class="detail-status-icon"><i class="mdi mdi-cloud-outline"></i></div>
      <div class="detail-status-body">
        <strong>${escapeHtml(t("detail.remote.title"))}</strong>
        <p>${escapeHtml(t("detail.remote.body"))}</p>
        <code>${escapeHtml(repo.rootPath)}</code>
      </div>
    </div>`
  }
  return ""
}

function renderDetailTabs(repo) {
  const available = getAvailableDetailTabs(repo)
  const statusBanner = renderDetailStatusBanner(repo)
  if (!available.length) return statusBanner

  let activeTab = getActiveDetailTab(repo.id)
  if (!available.includes(activeTab)) activeTab = available[0]

  const tabsHtml = available
    .map((tab) => {
      const icon = tab === "scripts" ? "mdi-play-circle-outline" : "mdi-code-braces"
      const label = tab === "scripts" ? t("detail.tabs.scripts") : t("detail.tabs.env")
      return `<button type="button" class="inspector-tab ${activeTab === tab ? "active" : ""}" data-tab="${tab}"><i class="mdi ${icon}"></i><span>${escapeHtml(label)}</span></button>`
    })
    .join("")

  const panelsHtml = available
    .map((tab) => {
      const content = tab === "scripts" ? renderScripts(repo) : renderEnvPanel(repo)
      return `<div class="inspector-tab-panel ${activeTab === tab ? "" : "hidden"}" data-tab="${tab}">${content}</div>`
    })
    .join("")

  return `${statusBanner}<div class="inspector-tabs">${tabsHtml}</div>${panelsHtml}`
}

async function loadEnvData(repoId) {
  const data = await api(`/api/repos/${encodeURIComponent(repoId)}/env`)
  envDataCache.set(repoId, data)
  return data
}

async function refreshEnvPanel(repoId) {
  if (selectedRepoId !== repoId) return
  const panel = detailContent.querySelector('.inspector-tab-panel[data-tab="env"]')
  if (!panel) return
  const repo = repos.get(repoId)
  if (!repo) return
  panel.innerHTML = renderEnvPanel(repo)
}

function markEnvChanged(repoId) {
  if (getAliveSessionsForRepo(repoId).length) {
    envRestartPending.add(repoId)
  }
}

async function saveEnvEntries(repoId, entries) {
  const result = await api(`/api/repos/${encodeURIComponent(repoId)}/env`, {
    method: "PUT",
    body: JSON.stringify({ entries })
  })
  envDataCache.set(repoId, result)
  markEnvChanged(repoId)
  await refreshEnvPanel(repoId)
}

async function switchEnvVariant(repoId, key, variantIndex) {
  const result = await api(`/api/repos/${encodeURIComponent(repoId)}/env/variant`, {
    method: "POST",
    body: JSON.stringify({ key, variantIndex })
  })
  envDataCache.set(repoId, result)
  markEnvChanged(repoId)
  await refreshEnvPanel(repoId)
}

async function addEnvVariant(repoId, key, value) {
  const result = await api(`/api/repos/${encodeURIComponent(repoId)}/env/variants`, {
    method: "POST",
    body: JSON.stringify({ key, value })
  })
  envDataCache.set(repoId, result)
  markEnvChanged(repoId)
  await refreshEnvPanel(repoId)
}

function initDetailPanelEvents() {
  if (detailPanelBound) return
  detailPanelBound = true

  detailContent.addEventListener("click", async (e) => {
    const tab = e.target.closest(".inspector-tab")
    if (tab && selectedRepoId) {
      const repo = repos.get(selectedRepoId)
      if (!repo) return
      const name = tab.dataset.tab
      if (!name || name === getActiveDetailTab(repo.id)) return
      await setActiveDetailTab(repo.id, name)
      renderDetail()
      return
    }

    const favBtn = e.target.closest(".script-fav")
    if (favBtn?.dataset.repo && favBtn?.dataset.script) {
      e.stopPropagation()
      try {
        await toggleFavoriteScript(favBtn.dataset.repo, favBtn.dataset.script)
      } catch (err) {
        alert(err.message || t("scripts.favoriteError"))
      }
      return
    }

    const createBtn = e.target.closest(".env-create-btn")
    if (createBtn?.dataset.repo) {
      try {
        await saveEnvEntries(createBtn.dataset.repo, [])
      } catch (err) {
        alert(err.message || t("env.saveError"))
      }
      return
    }

    const restartBtn = e.target.closest(".env-restart-btn")
    if (restartBtn?.dataset.repo) {
      const repoId = restartBtn.dataset.repo
      const sessions = getAliveSessionsForRepo(repoId)
      for (const s of sessions) {
        await restartScript(repoId, s.label)
      }
      envRestartPending.delete(repoId)
      await refreshEnvPanel(repoId)
      return
    }

    const dismissBtn = e.target.closest(".env-restart-dismiss")
    if (dismissBtn?.dataset.repo) {
      envRestartPending.delete(dismissBtn.dataset.repo)
      await refreshEnvPanel(dismissBtn.dataset.repo)
      return
    }

    const variantBtn = e.target.closest(".env-variant-radio")
    if (variantBtn?.dataset.key != null && selectedRepoId) {
      const index = parseInt(variantBtn.dataset.index, 10)
      if (Number.isNaN(index)) return
      try {
        await switchEnvVariant(selectedRepoId, variantBtn.dataset.key, index)
      } catch (err) {
        alert(err.message || t("env.saveError"))
      }
      return
    }

    const copyBtn = e.target.closest(".env-copy-btn")
    if (copyBtn?.dataset.repo) {
      try {
        const includeCommented = envIncludeCommentedChecked()
        const qs = includeCommented ? "?includeCommented=1" : ""
        const data = await api(
          `/api/repos/${encodeURIComponent(copyBtn.dataset.repo)}/env/export${qs}`
        )
        await navigator.clipboard.writeText(data.text || "")
        flashActionButton(copyBtn)
        showToast(t("env.copySuccess"))
      } catch (err) {
        showToast(err.message || t("env.copyError"), { type: "error" })
      }
      return
    }

    const exampleBtn = e.target.closest(".env-example-btn")
    if (exampleBtn?.dataset.repo) {
      try {
        const includeCommented = envIncludeCommentedChecked()
        const data = await api(`/api/repos/${encodeURIComponent(exampleBtn.dataset.repo)}/env/example`, {
          method: "POST",
          body: JSON.stringify({ includeCommented })
        })
        flashActionButton(exampleBtn)
        showToast(t("env.exampleSuccess", { path: ".env.example" }))
      } catch (err) {
        showToast(err.message || t("env.exampleError"), { type: "error" })
      }
      return
    }

    const includeCommentedCb = e.target.closest(".env-include-commented-cb")
    if (includeCommentedCb) {
      envIncludeCommented = includeCommentedCb.checked
      localStorage.setItem("dock-env-include-commented", envIncludeCommented ? "1" : "0")
      return
    }

    const addVariantBtn = e.target.closest(".env-add-variant")
    if (addVariantBtn?.dataset.key && selectedRepoId) {
      const value = prompt(t("env.variantPrompt"))
      if (value === null) return
      try {
        await addEnvVariant(selectedRepoId, addVariantBtn.dataset.key, value)
      } catch (err) {
        alert(err.message || t("env.saveError"))
      }
      return
    }

    if (e.target.closest(".env-add-variable-btn") && selectedRepoId) {
      const keyInput = detailContent.querySelector(".env-new-key")
      const valueInput = detailContent.querySelector(".env-new-value")
      const key = keyInput?.value.trim()
      const value = valueInput?.value ?? ""
      if (!key) return
      const data = envDataCache.get(selectedRepoId) || { entries: [] }
      const entries = [
        ...(data.entries || []),
        { type: "var", key, variants: [{ value, active: true }] }
      ]
      try {
        await saveEnvEntries(selectedRepoId, entries)
        if (keyInput) keyInput.value = ""
        if (valueInput) valueInput.value = ""
      } catch (err) {
        alert(err.message || t("env.saveError"))
      }
    }
  })

  detailContent.addEventListener(
    "focusout",
    async (e) => {
      const input = e.target.closest(".env-value-input")
      if (!input || !selectedRepoId) return
      const key = input.dataset.key
      const index = parseInt(input.dataset.index, 10)
      if (!key || Number.isNaN(index)) return
      const data = envDataCache.get(selectedRepoId)
      if (!data) return
      const entry = (data.entries || []).find((item) => item.type === "var" && item.key === key)
      if (!entry || entry.variants[index]?.value === input.value) return
      const entries = JSON.parse(JSON.stringify(data.entries))
      const target = entries.find((item) => item.type === "var" && item.key === key)
      if (!target) return
      target.variants[index].value = input.value
      try {
        await saveEnvEntries(selectedRepoId, entries)
      } catch (err) {
        alert(err.message || t("env.saveError"))
      }
    },
    true
  )
}

function renderDetail() {
  applyDetailState()
  if (!selectedRepoId || !repos.has(selectedRepoId)) {
    detailContent.classList.add("hidden")
    detailContent.innerHTML = ""
    return
  }

  const repo = repos.get(selectedRepoId)
  detailContent.classList.remove("hidden")

  const linkReady = !!repo.openLinkReady
  const linkLabel = openLinkLabel(repo.openLink)
  const linkBtn = repo.openLink
    ? linkReady
      ? `<a class="btn-open-primary" href="${escapeHtml(repo.openLink.url)}" target="_blank" rel="noopener"><i class="mdi mdi-open-in-new"></i> ${escapeHtml(linkLabel)}</a>`
      : `<button type="button" class="btn-open-primary" disabled title="${escapeHtml(t("detail.startDevHint"))}"><i class="mdi mdi-open-in-new"></i> ${escapeHtml(linkLabel)}</button>`
    : ""

  const folderBtn = repo.path
    ? `<button type="button" class="btn-icon-square" onclick="openFolder('${jsStr(repo.id)}')" title="${escapeHtml(t("detail.openFolder"))}"><i class="mdi mdi-folder-open-outline"></i></button>`
    : ""

  const ideBtn = repo.path
    ? `<button type="button" class="btn-icon-square" onclick="openIde('${jsStr(repo.id)}')" title="${escapeHtml(t("detail.openIde"))}"><i class="mdi mdi-application-brackets-outline"></i></button>`
    : ""

  const githubBtn = repo.githubUrl
    ? `<button type="button" class="btn-icon-square" onclick="openGithub('${jsStr(repo.id)}')" title="GitHub"><i class="mdi mdi-github"></i></button>`
    : ""

  const isHiddenView = repo.enabled === false
  const tag = !isHiddenView && primaryTagOf(repo) ? primaryTagOf(repo) : ""
  const categoryBadge = tag
    ? `<span class="inspector-tag-badge"><i class="mdi ${getCategoryIcon(tag)}"></i> ${formatTagHtml(tag)}</span>`
    : ""

  const gitRow = repo.hasGit
    ? `<div class="inspector-git-row">
        <div class="branch-picker" id="branch-picker">
          <button type="button" class="branch-picker-btn" id="branch-picker-btn">
            <i class="mdi mdi-source-branch"></i>
            <span>${escapeHtml(repo.branch || "—")}</span>
            <i class="mdi mdi-chevron-down branch-picker-caret"></i>
          </button>
          <div class="branch-picker-menu hidden" id="branch-picker-menu">
            <input type="search" class="branch-picker-search" id="branch-picker-search" placeholder="${escapeHtml(t("detail.branchSearch"))}" />
            <div class="branch-picker-list" id="branch-picker-list"></div>
          </div>
        </div>
        <button type="button" class="btn btn-sm" onclick="gitPull('${jsStr(repo.id)}')"><i class="mdi mdi-source-pull"></i> pull</button>
        <button type="button" class="btn btn-sm" onclick="gitFetch('${jsStr(repo.id)}')"><i class="mdi mdi-cloud-download-outline"></i> fetch</button>
      </div>`
    : ""

  detailContent.innerHTML = `
    <div class="inspector">
      <div class="inspector-header">
        <div class="inspector-title-row">
          <h2>${escapeHtml(repo.name)}</h2>
          ${categoryBadge}
        </div>
        <div class="inspector-path">${escapeHtml(repo.path || repo.rootPath || "")}</div>
      </div>
      <div class="inspector-actions">
        ${linkBtn}
        ${folderBtn}
        ${ideBtn}
        ${githubBtn}
        <button type="button" class="btn-icon-square" onclick="openProjectMenu('${jsStr(repo.id)}', this)" title="${escapeHtml(t("detail.actions"))}">
          <i class="mdi mdi-dots-vertical"></i>
        </button>
      </div>
      ${gitRow}
      ${renderDetailTabs(repo)}
    </div>
  `

  initDetailPanelEvents()
  initScriptsDnD()
  initBranchPicker(repo)
  updateTerminalUI()

  if (getActiveDetailTab(repo.id) === "env" && repoHasEnv(repo)) {
    loadEnvData(repo.id)
      .then(() => {
        if (selectedRepoId === repo.id) refreshEnvPanel(repo.id)
      })
      .catch((err) => {
        const panel = detailContent.querySelector('.inspector-tab-panel[data-tab="env"]')
        if (panel && selectedRepoId === repo.id) {
          panel.innerHTML = `<div class="env-panel env-error"><p>${escapeHtml(err.message || t("env.saveError"))}</p></div>`
        }
      })
  }
}

let branchPickerCloseHandler = null

function initBranchPicker(repo) {
  const btn = document.getElementById("branch-picker-btn")
  const menu = document.getElementById("branch-picker-menu")
  const search = document.getElementById("branch-picker-search")
  const list = document.getElementById("branch-picker-list")
  if (!btn || !menu || !list) return

  if (branchPickerCloseHandler) {
    document.removeEventListener("click", branchPickerCloseHandler)
    branchPickerCloseHandler = null
  }

  const renderBranches = (query = "") => {
    const q = query.trim().toLowerCase()
    const branches = (repo.branches || []).filter((b) => !q || b.toLowerCase().includes(q))
    list.innerHTML = branches.length
      ? branches
          .map((b) => {
            const active = b === repo.branch ? "active" : ""
            return `<button type="button" class="branch-picker-item ${active}" data-branch="${escapeHtml(b)}">${escapeHtml(b)}</button>`
          })
          .join("")
      : '<div class="branch-picker-empty">' + escapeHtml(t("detail.noBranches")) + "</div>"
    list.querySelectorAll(".branch-picker-item").forEach((item) => {
      item.addEventListener("click", async () => {
        menu.classList.add("hidden")
        if (item.dataset.branch === repo.branch) return
        await api(`/api/repos/${encodeURIComponent(repo.id)}/checkout`, {
          method: "POST",
          body: JSON.stringify({ branch: item.dataset.branch })
        })
        await refreshRepoGit(repo.id)
      })
    })
  }

  renderBranches()
  btn.onclick = (e) => {
    e.stopPropagation()
    menu.classList.toggle("hidden")
    if (!menu.classList.contains("hidden")) {
      search.value = ""
      renderBranches()
      search.focus()
    }
  }
  search.oninput = () => renderBranches(search.value)
  search.onclick = (e) => e.stopPropagation()
  branchPickerCloseHandler = (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add("hidden")
  }
  document.addEventListener("click", branchPickerCloseHandler)
}

function updateOpenLinkButton(repo) {
  if (!repo?.openLink) return
  const actions = detailContent.querySelector(".inspector-actions")
  if (!actions) return

  const linkReady = !!repo.openLinkReady
  const linkLabel = openLinkLabel(repo.openLink)
  const html = linkReady
    ? `<a class="btn-open-primary" href="${escapeHtml(repo.openLink.url)}" target="_blank" rel="noopener"><i class="mdi mdi-open-in-new"></i> ${escapeHtml(linkLabel)}</a>`
    : `<button type="button" class="btn-open-primary" disabled title="${escapeHtml(t("detail.startDevHint"))}"><i class="mdi mdi-open-in-new"></i> ${escapeHtml(linkLabel)}</button>`

  const current = actions.querySelector(".btn-open-primary")
  const wrap = document.createElement("div")
  wrap.innerHTML = html
  const next = wrap.firstElementChild
  if (current) current.replaceWith(next)
  else actions.prepend(next)
}

function renderAll() {
  renderSidebar()
  renderProjectList()
  renderDetail()
  renderSessionTabs()
}

function applyTerminalState() {
  const bar = document.getElementById("bottom-bar")
  const workspace = document.querySelector(".workspace")
  const toggleIcon = document.getElementById("terminal-toggle-icon")
  const maxIcon = document.getElementById("terminal-maximize-icon")
  if (!bar) return
  document.documentElement.style.setProperty("--term-body-h", `${terminalBodyHeight}px`)
  bar.classList.toggle("collapsed", terminalCollapsed && !terminalMaximized)
  bar.classList.toggle("maximized", terminalMaximized)
  workspace?.classList.toggle("term-maximized", terminalMaximized)
  if (toggleIcon) {
    toggleIcon.className = terminalCollapsed ? "mdi mdi-chevron-up" : "mdi mdi-chevron-down"
  }
  if (maxIcon) {
    maxIcon.className = terminalMaximized ? "mdi mdi-arrow-collapse" : "mdi mdi-arrow-expand"
  }
  const toggleBtn = document.getElementById("terminal-toggle")
  if (toggleBtn) {
    toggleBtn.title = terminalCollapsed ? t("terminal.expand") : t("terminal.collapse")
  }
}

function initTerminalResize() {
  const handle = document.getElementById("term-resize-handle")
  const workspace = document.querySelector(".workspace")
  if (!handle) return

  let resizing = false
  let startY = 0
  let startH = 0

  const clamp = (h) => {
    const max = Math.floor(window.innerHeight * 0.75)
    return Math.min(max, Math.max(80, h))
  }

  const onMove = (e) => {
    if (!resizing) return
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    terminalBodyHeight = clamp(startH + (startY - clientY))
    document.documentElement.style.setProperty("--term-body-h", `${terminalBodyHeight}px`)
  }

  const onEnd = () => {
    if (!resizing) return
    resizing = false
    handle.classList.remove("active")
    workspace?.classList.remove("term-resizing")
    localStorage.setItem("dock-term-body-h", String(terminalBodyHeight))
  }

  const onStart = (e) => {
    if (terminalCollapsed || terminalMaximized) return
    e.preventDefault()
    resizing = true
    startY = e.touches ? e.touches[0].clientY : e.clientY
    startH = terminalBodyHeight
    handle.classList.add("active")
    workspace?.classList.add("term-resizing")
  }

  handle.addEventListener("mousedown", onStart)
  handle.addEventListener("touchstart", onStart, { passive: false })
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onEnd)
  window.addEventListener("touchmove", onMove, { passive: true })
  window.addEventListener("touchend", onEnd)
}

function initDetailResize() {
  const handle = document.getElementById("detail-resize-handle")
  const detailPanel = document.getElementById("detail-panel")
  if (!handle || !detailPanel) return

  let resizing = false
  let startX = 0
  let startW = 0
  let rawWidth = 0
  let closeReady = false
  let rafId = null

  const maxDetailWidth = () => Math.floor(window.innerWidth * 0.6)

  const scheduleWidth = (w) => {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      detailPanel.style.width = `${w}px`
      rafId = null
    })
  }

  const onMove = (e) => {
    if (!resizing) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    rawWidth = startW + (startX - clientX)
    const maxW = maxDetailWidth()

    if (rawWidth >= MIN_DETAIL_WIDTH) {
      closeReady = false
      detailWidth = Math.min(maxW, rawWidth)
      scheduleWidth(detailWidth)
      return
    }

    const overshoot = MIN_DETAIL_WIDTH - rawWidth
    closeReady = overshoot >= DETAIL_CLOSE_OVERSHOOT
    const visual = MIN_DETAIL_WIDTH - Math.min(overshoot, DETAIL_CLOSE_OVERSHOOT) * 0.35
    scheduleWidth(visual)
  }

  const onEnd = () => {
    if (!resizing) return
    resizing = false
    handle.classList.remove("active")
    appEl.classList.remove("detail-resizing")
    if (closeReady) {
      closeDetailPanel({ keepClosed: true })
      return
    }
    const maxW = maxDetailWidth()
    detailWidth = Math.max(
      MIN_DETAIL_WIDTH,
      Math.min(maxW, rawWidth >= MIN_DETAIL_WIDTH ? rawWidth : MIN_DETAIL_WIDTH)
    )
    applyDetailState()
    saveDetailPrefs()
  }

  const onStart = (e) => {
    if (detailCollapsed || !selectedRepoId) return
    e.preventDefault()
    resizing = true
    closeReady = false
    startX = e.touches ? e.touches[0].clientX : e.clientX
    startW = detailWidth
    handle.classList.add("active")
    appEl.classList.add("detail-resizing")
  }

  handle.addEventListener("mousedown", onStart)
  handle.addEventListener("touchstart", onStart, { passive: false })
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onEnd)
  window.addEventListener("touchmove", onMove, { passive: true })
  window.addEventListener("touchend", onEnd)
}

function initSidebarResize() {
  const handle = document.getElementById("sidebar-resize-handle")
  const sidebar = document.getElementById("sidebar")
  if (!handle || !sidebar) return

  let resizing = false
  let startX = 0
  let startW = 0
  let rawWidth = 0
  let collapseReady = false
  let wasCollapsed = false

  const maxSidebarWidth = () => Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.35))

  const setPreviewWidth = (w) => {
    document.documentElement.style.setProperty("--sidebar-w", `${w}px`)
  }

  const updatePreviewLabels = (w) => {
    const showLabels = wasCollapsed ? w >= SIDEBAR_EXPAND_THRESHOLD : true
    appEl.classList.toggle("sidebar-resize-preview", showLabels)
  }

  const finishResize = () => {
    if (!resizing) return
    resizing = false
    handle.classList.remove("active")
    appEl.classList.remove("sidebar-resizing", "sidebar-resize-preview")
    sidebar.style.width = ""

    if (wasCollapsed) {
      if (rawWidth >= SIDEBAR_EXPAND_THRESHOLD) {
        sidebarCollapsed = false
        sidebarWidth = Math.min(maxSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, rawWidth))
      } else {
        sidebarCollapsed = true
      }
    } else if (collapseReady) {
      sidebarCollapsed = true
    } else {
      sidebarCollapsed = false
      sidebarWidth = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(maxSidebarWidth(), rawWidth >= MIN_SIDEBAR_WIDTH ? rawWidth : MIN_SIDEBAR_WIDTH)
      )
    }

    wasCollapsed = false
    applySidebarState()
    saveSidebarPrefs()
  }

  const onMove = (e) => {
    if (!resizing) return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    rawWidth = startW + (clientX - startX)
    const maxW = maxSidebarWidth()

    if (wasCollapsed) {
      collapseReady = false
      const w = Math.max(SIDEBAR_COLLAPSED_W, Math.min(maxW, rawWidth))
      setPreviewWidth(w)
      updatePreviewLabels(w)
      return
    }

    if (rawWidth >= MIN_SIDEBAR_WIDTH) {
      collapseReady = false
      sidebarWidth = Math.min(maxW, rawWidth)
      setPreviewWidth(sidebarWidth)
      updatePreviewLabels(sidebarWidth)
      return
    }

    const overshoot = MIN_SIDEBAR_WIDTH - rawWidth
    collapseReady = overshoot >= SIDEBAR_COLLAPSE_OVERSHOOT
    const visual = MIN_SIDEBAR_WIDTH - Math.min(overshoot, SIDEBAR_COLLAPSE_OVERSHOOT) * 0.35
    const w = Math.max(SIDEBAR_COLLAPSED_W, visual)
    setPreviewWidth(w)
    updatePreviewLabels(w)
  }

  const onStart = (e) => {
    e.preventDefault()
    resizing = true
    wasCollapsed = sidebarCollapsed
    collapseReady = false
    startX = e.touches ? e.touches[0].clientX : e.clientX
    startW = wasCollapsed ? SIDEBAR_COLLAPSED_W : sidebarWidth
    handle.classList.add("active")
    appEl.classList.add("sidebar-resizing")
    setPreviewWidth(startW)
    updatePreviewLabels(startW)
  }

  handle.addEventListener("mousedown", onStart)
  handle.addEventListener("touchstart", onStart, { passive: false })
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", finishResize)
  window.addEventListener("touchmove", onMove, { passive: true })
  window.addEventListener("touchend", finishResize)
  window.addEventListener("blur", finishResize)
  handle.addEventListener("pointercancel", finishResize)
}

function applySidebarState() {
  const sidebar = document.getElementById("sidebar")
  appEl.classList.remove("sidebar-resizing", "sidebar-resize-preview")
  if (sidebar) sidebar.style.width = ""
  appEl.classList.toggle("sidebar-collapsed", sidebarCollapsed)
  if (!sidebarCollapsed) {
    document.documentElement.style.setProperty("--sidebar-w", `${sidebarWidth}px`)
  }
  sidebarNav.querySelectorAll(".nav-drag-handle").forEach((el) => {
    el.draggable = !sidebarCollapsed
  })
}

function saveSidebarPrefs() {
  return api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ sidebarCollapsed, sidebarWidth })
  }).catch(() => {})
}

function applyDetailState() {
  const hidden = !selectedRepoId || detailCollapsed
  const detailPanel = document.getElementById("detail-panel")
  appEl.classList.toggle("detail-hidden", hidden)
  if (detailPanel) {
    detailPanel.style.width = hidden ? "0px" : `${detailWidth}px`
  }
}

function saveDetailPrefs(extra = {}) {
  return api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({
      detailCollapsed,
      detailKeepClosed,
      detailWidth,
      ...extra
    })
  }).catch(() => {})
}

function closeDetailPanel({ keepClosed = true } = {}) {
  detailCollapsed = true
  if (keepClosed) detailKeepClosed = true
  applyDetailState()
  renderProjectList()
  return saveDetailPrefs()
}

async function openDetailPanel() {
  if (!selectedRepoId) return
  detailCollapsed = false
  detailKeepClosed = false
  applyDetailState()
  renderProjectList()
  renderDetail()
  await saveDetailPrefs()
}

function collapseTerminal() {
  terminalCollapsed = true
  if (terminalMaximized) terminalMaximized = false
  applyTerminalState()
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ terminalCollapsed: true })
  }).catch(() => {})
}

function toggleTerminalCollapsed() {
  terminalCollapsed = !terminalCollapsed
  if (!terminalCollapsed) terminalMaximized = false
  applyTerminalState()
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ terminalCollapsed })
  }).catch(() => {})
}

function toggleTerminalMaximized() {
  terminalMaximized = !terminalMaximized
  if (terminalMaximized) terminalCollapsed = false
  applyTerminalState()
}

function mergeReposFromApi(data) {
  repos.clear()
  const hiddenIds = new Set((data.hiddenRepos || []).map((repo) => repo.id))
  const visibleIds = new Set((data.repos || []).map((repo) => repo.id))
  for (const repo of [...(data.hiddenRepos || []), ...(data.repos || [])]) {
    repos.set(repo.id, repo)
  }
  for (const id of pendingShownIds) {
    const repo = repos.get(id)
    if (repo) repos.set(id, { ...repo, enabled: true })
    if (visibleIds.has(id) && !hiddenIds.has(id)) pendingShownIds.delete(id)
  }
  for (const id of pendingHiddenIds) {
    const repo = repos.get(id)
    if (repo) repos.set(id, { ...repo, enabled: false })
    if (hiddenIds.has(id) && !visibleIds.has(id)) pendingHiddenIds.delete(id)
  }
}

async function loadRepos() {
  const data = await api("/api/repos")

  mergeReposFromApi(data)
  tags = data.tags || []
  scriptOrder = data.scriptOrder || {}
  if (data.listView === "table" || data.listView === "cards") listView = data.listView
  listSort = data.listSort || "name"
  listFilters = data.listFilters || { running: false, dirty: false }
  recentProjects = data.recentProjects || {}
  projectOrder = data.projectOrder || {}
  homePath = data.homePath || ""
  if (data.activeTag) activeTag = data.activeTag
  if (typeof data.sidebarCollapsed === "boolean") sidebarCollapsed = data.sidebarCollapsed
  if (typeof data.sidebarWidth === "number" && data.sidebarWidth >= MIN_SIDEBAR_WIDTH) {
    sidebarWidth = data.sidebarWidth
  }
  if (!detailPrefsHydrated) {
    if (typeof data.detailCollapsed === "boolean") detailCollapsed = data.detailCollapsed
    if (typeof data.detailKeepClosed === "boolean") detailKeepClosed = data.detailKeepClosed
    if (typeof data.detailWidth === "number" && data.detailWidth >= MIN_DETAIL_WIDTH) {
      detailWidth = data.detailWidth
    }
    detailPrefsHydrated = true
  }
  if (typeof data.terminalCollapsed === "boolean") terminalCollapsed = data.terminalCollapsed
  if (data.locale && data.locale !== I18n.locale) {
    await I18n.load(data.locale)
  } else {
    I18n.applyStatic()
  }
  tagIcons = data.tagIcons || {}
  stripNumbersInJson = !!data.stripNumbersInJson
  detailTabPrefs = data.detailTab || {}
  favoriteScripts = data.favoriteScripts || {}
  applySidebarState()
  applyDetailState()
  applyTerminalState()

  if (selectedRepoId && !repos.has(selectedRepoId)) selectedRepoId = null
  if (activeTag !== "__all__" && !tags.includes(activeTag)) {
    activeTag = "__all__"
  }

  for (const s of data.sessions || []) {
    ensureSession(s.id, s.repo, s.label)
  }

  renderAll()
  hydrateGitForVisible()
}

async function hydrateGitForVisible() {
  if (showHiddenOnly) return
  const list = filterRepos(getVisibleRepos()).filter((r) => r.hasGit && r.path)
  if (!list.length) return

  const token = ++gitHydrateToken
  gitHydrating = true
  renderProjectList()

  const results = await Promise.allSettled(
    list.map((r) => api(`/api/repos/${encodeURIComponent(r.id)}`))
  )

  if (token !== gitHydrateToken) return

  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return
    const id = list[i].id
    repos.set(id, { ...repos.get(id), ...result.value })
  })

  gitHydrating = false
  renderProjectList()
  if (selectedRepoId) renderDetail()
}

function selectRepo(id) {
  selectedRepoId = id
  if (!detailKeepClosed) detailCollapsed = false
  recentProjects[id] = Date.now()
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ recentProjects })
  }).catch(() => {})
  applyDetailState()
  renderProjectList()
  renderDetail()
  updateTerminalUI()
  const repo = repos.get(id)
  if (repo?.openLink) refreshOpenLinkReady(id).catch(() => {})
  if (repo?.hasGit && !repo.branch) {
    api(`/api/repos/${encodeURIComponent(id)}`)
      .then((details) => {
        repos.set(id, { ...repos.get(id), ...details })
        renderProjectList()
        renderDetail()
      })
      .catch(() => {})
  }
}

function ansiToHtml(text) {
  const ANSI = {
    0: null,
    1: "bold",
    2: "dim",
    4: "underline",
    30: "#7f8c8d",
    31: "#f87171",
    32: "#22c55e",
    33: "#fbbf24",
    34: "#60a5fa",
    35: "#c084fc",
    36: "#22d3ee",
    37: "#e6edf3",
    39: null,
    90: "#8b949e",
    91: "#fca5a5",
    92: "#4ade80",
    93: "#fcd34d",
    94: "#93c5fd",
    95: "#d8b4fe",
    96: "#67e8f9",
    97: "#ffffff"
  }
  let html = ""
  let open = false
  let bold = false
  let dim = false
  let underline = false
  let color = null

  const closeSpan = () => {
    if (open) {
      html += "</span>"
      open = false
    }
  }

  const openSpan = () => {
    closeSpan()
    const classes = []
    if (bold) classes.push("ansi-bold")
    if (dim) classes.push("ansi-dim")
    if (underline) classes.push("ansi-underline")
    const style = color ? ` style="color:${color}"` : ""
    if (!classes.length && !color) return
    html += `<span class="${classes.join(" ")}"${style}>`
    open = true
  }

  const parts = String(text).split(/(\x1b\[[0-9;]*m)/)
  for (const part of parts) {
    if (!part) continue
    const m = /^\x1b\[([0-9;]*)m$/.exec(part)
    if (m) {
      const codes = m[1] ? m[1].split(";").map(Number) : [0]
      for (const code of codes) {
        if (code === 0) {
          bold = false
          dim = false
          underline = false
          color = null
          closeSpan()
        } else if (code === 1) bold = true
        else if (code === 2) dim = true
        else if (code === 4) underline = true
        else if (code === 22) {
          bold = false
          dim = false
        } else if (code === 24) underline = false
        else if (code === 39) color = null
        else if (ANSI[code] && typeof ANSI[code] === "string" && ANSI[code].startsWith("#")) {
          color = ANSI[code]
        } else if (code >= 30 && code <= 37) color = ANSI[code] || color
        else if (code >= 90 && code <= 97) color = ANSI[code] || color
      }
      openSpan()
      continue
    }
    if (!open && (bold || dim || underline || color)) openSpan()
    html += escapeHtml(part)
  }
  closeSpan()
  return html.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
}

let startingDotsTimer = null

function stopStartingDots() {
  if (startingDotsTimer) {
    clearInterval(startingDotsTimer)
    startingDotsTimer = null
  }
  logOutput.querySelectorAll(".log-line.starting").forEach((el) => el.remove())
}

function startStartingDots(baseText) {
  stopStartingDots()
  const line = document.createElement("div")
  line.className = "log-line starting"
  const time = new Date().toISOString().slice(11, 19)
  const msg = document.createElement("span")
  msg.className = "log-msg"
  line.innerHTML = `<span class="log-time">[${time}]</span> `
  line.appendChild(msg)
  logOutput.appendChild(line)
  let n = 1
  const paint = () => {
    msg.textContent = `${baseText}${".".repeat(n)}`
    n = n >= 3 ? 1 : n + 1
    logOutput.scrollTop = logOutput.scrollHeight
  }
  paint()
  startingDotsTimer = setInterval(paint, 450)
}

function appendLogLine(entry) {
  if (entry.type === "starting" || entry.i18nKey === "log.processStarting") {
    startStartingDots(
      entry.i18nKey
        ? t(entry.i18nKey, entry.i18nParams || {})
        : entry.message || t("log.processStarting")
    )
    return
  }
  if (
    entry.type === "stdout" ||
    entry.type === "stderr" ||
    entry.type === "cmd" ||
    entry.type === "success"
  ) {
    stopStartingDots()
  }
  if (/^npm notice/i.test(String(entry.message || "").trim())) return

  const line = document.createElement("div")
  line.className = `log-line ${entry.type || "info"}`
  const text = entry.i18nKey ? t(entry.i18nKey, entry.i18nParams || {}) : entry.message || ""
  const time = entry.time?.slice(11, 19) || ""
  const useAnsi = entry.type === "stdout" || entry.type === "stderr" || /\x1b\[/.test(text)
  if (useAnsi) {
    line.innerHTML = `<span class="log-time">[${escapeHtml(time)}]</span> <span class="log-msg">${ansiToHtml(text)}</span>`
  } else {
    line.innerHTML = `<span class="log-time">[${escapeHtml(time)}]</span> <span class="log-msg">${escapeHtml(text)}</span>`
  }
  logOutput.appendChild(line)
  logOutput.scrollTop = logOutput.scrollHeight
}

function renderLogBuffer() {
  logOutput.innerHTML = ""
  if (!activeSessionId) return
  const session = sessionState.get(activeSessionId)
  if (!session) return
  for (const entry of session.logs) appendLogLine(entry)
}

function renderSessionTabs() {
  const list = [...sessionState.values()]
  if (!list.length) {
    sessionTabs.innerHTML = ""
    return
  }
  sessionTabs.innerHTML = list
    .map((s) => {
      const repo = repos.get(s.repo)
      const label = repo?.name || s.repo
      const active = s.id === activeSessionId ? "active" : ""
      const exited = s.alive ? "" : "exited"
      return `<div class="term-tab-wrap ${active} ${exited}" data-session="${escapeHtml(s.id)}">
        <button type="button" class="term-tab">
          <span class="term-tab-dot ${s.alive ? "alive" : ""}"></span>
          ${escapeHtml(label)} · ${escapeHtml(s.label)}
        </button>
        <button type="button" class="term-tab-close" data-session="${escapeHtml(s.id)}" title="${escapeHtml(t("terminal.closeTab"))}"><i class="mdi mdi-close"></i></button>
      </div>`
    })
    .join("")

  sessionTabs.querySelectorAll(".term-tab-wrap").forEach((wrap) => {
    wrap.querySelector(".term-tab")?.addEventListener("click", () => {
      activeSessionId = wrap.dataset.session
      if (terminalCollapsed) {
        terminalCollapsed = false
        applyTerminalState()
        api("/api/preferences", {
          method: "PUT",
          body: JSON.stringify({ terminalCollapsed })
        }).catch(() => {})
      }
      renderSessionTabs()
      renderLogBuffer()
      updateTerminalUI()
    })
  })

  sessionTabs.querySelectorAll(".term-tab-close").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation()
      closeSessionTab(btn.dataset.session)
    })
  })
}

async function closeSessionTab(sessionId) {
  const session = sessionState.get(sessionId)
  if (!session) return
  if (session.alive) {
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/stop`, {
      method: "POST",
      body: "{}"
    })
  }
  sessionState.delete(sessionId)
  if (activeSessionId === sessionId) {
    const remaining = [...sessionState.values()]
    activeSessionId = remaining.find((s) => s.alive)?.id || remaining[0]?.id || null
    renderLogBuffer()
  }
  renderSessionTabs()
  updateTerminalUI()
  if (session.repo) {
    syncRepoRunningState(session.repo)
    updateScriptRowsForRepo(session.repo)
  }
}

async function closeAllSessions() {
  if (sessionState.size) {
    await api("/api/sessions/close-all", { method: "POST", body: "{}" })
    const repoIds = new Set([...sessionState.values()].map((s) => s.repo))
    sessionState.clear()
    activeSessionId = null
    logOutput.innerHTML = ""
    renderSessionTabs()
    updateTerminalUI()
    for (const id of repoIds) {
      syncRepoRunningState(id)
      updateScriptRowsForRepo(id)
    }
  }
  collapseTerminal()
}

function ensureSession(sessionId, repo, label) {
  if (sessionState.has(sessionId)) {
    const s = sessionState.get(sessionId)
    s.alive = true
    s.repo = repo
    s.label = label
    return
  }
  sessionState.set(sessionId, { id: sessionId, repo, label, alive: true, logs: [] })
}

function onLogEntry(entry) {
  if (entry.sessionId && sessionState.has(entry.sessionId)) {
    sessionState.get(entry.sessionId).logs.push(entry)
    const s = sessionState.get(entry.sessionId)
    if (s?.alive) scheduleOpenLinkRefresh(s.repo)
  }
  if (activeSessionId === entry.sessionId || !activeSessionId) {
    if (!activeSessionId && entry.sessionId) activeSessionId = entry.sessionId
    appendLogLine(entry)
  }
}

const openLinkRefreshTimers = new Map()

function scheduleOpenLinkRefresh(repoId) {
  const repo = repos.get(repoId)
  if (!repo?.openLink || repo.openLinkReady) return
  if (openLinkRefreshTimers.has(repoId)) return
  openLinkRefreshTimers.set(
    repoId,
    setTimeout(() => {
      openLinkRefreshTimers.delete(repoId)
      refreshOpenLinkReady(repoId).catch(() => {})
    }, 400)
  )
}

function onSessionEvent(data) {
  if (data.type === "start") {
    ensureSession(data.sessionId, data.repo, data.label)
    activeSessionId = data.sessionId
    if (terminalCollapsed) {
      terminalCollapsed = false
      applyTerminalState()
    }
    renderSessionTabs()
    renderLogBuffer()
    updateTerminalUI()
    syncRepoRunningState(data.repo)
    if (selectedRepoId === data.repo) updateScriptRowsForRepo(data.repo)
    scheduleOpenLinkPoll(data.repo)
    return
  }
  if (data.type === "exit") {
    const s = sessionState.get(data.sessionId)
    const label = data.label || s?.label || "script"
    const repo = repos.get(data.repo)
    const projectName = repo?.name || data.repo
    if (s) s.alive = false
    renderSessionTabs()
    updateTerminalUI()
    syncRepoRunningState(data.repo)
    if (selectedRepoId === data.repo) updateScriptRowsForRepo(data.repo)
    refreshOpenLinkReady(data.repo).catch(() => {})
    if (data.code === 0) {
      showToast(t("toast.scriptFinished", { name: label, project: projectName }))
    } else if (data.code === null) {
      showToast(t("toast.scriptStopped", { name: label, project: projectName }), { type: "warning" })
    } else {
      showToast(t("toast.scriptFailed", { name: label, project: projectName, code: data.code }), {
        type: "error"
      })
    }
  }
}

function syncRepoRunningState(id) {
  const existing = repos.get(id)
  if (!existing) return
  const aliveCount = [...sessionState.values()].filter((s) => s.repo === id && s.alive).length
  const isRunning = aliveCount > 0
  if (existing.isRunning === isRunning && existing.sessionCount === aliveCount) return
  repos.set(id, { ...existing, isRunning, sessionCount: aliveCount })
  renderProjectList()
}

async function refreshOpenLinkReady(id) {
  const existing = repos.get(id)
  if (!existing?.openLink) return
  try {
    const details = await api(`/api/repos/${encodeURIComponent(id)}`)
    const wasReady = !!existing.openLinkReady
    const isReady = !!details.openLinkReady
    const urlChanged = (existing.openLink?.url || "") !== (details.openLink?.url || "")
    repos.set(id, {
      ...existing,
      openLink: details.openLink ?? existing.openLink,
      openLinkReady: isReady
    })
    if (selectedRepoId === id && (wasReady !== isReady || urlChanged)) {
      updateOpenLinkButton(repos.get(id))
    }
  } catch {
    /* ignore */
  }
}

let openLinkPollTimer = null

function scheduleOpenLinkPoll(id) {
  if (openLinkPollTimer) clearInterval(openLinkPollTimer)
  let attempts = 0
  openLinkPollTimer = setInterval(() => {
    attempts += 1
    const repo = repos.get(id)
    if (!repo?.openLink || repo.openLinkReady || attempts > 120) {
      clearInterval(openLinkPollTimer)
      openLinkPollTimer = null
      return
    }
    refreshOpenLinkReady(id).catch(() => {})
  }, 1000)
}

async function refreshRepoGit(id) {
  const existing = repos.get(id)
  if (!existing?.hasGit) return
  try {
    const details = await api(`/api/repos/${encodeURIComponent(id)}`)
    repos.set(id, {
      ...existing,
      branch: details.branch,
      branches: details.branches,
      isDirty: details.isDirty,
      dirtyCount: details.dirtyCount,
      githubUrl: details.githubUrl ?? existing.githubUrl,
      openLink: details.openLink ?? existing.openLink,
      openLinkReady: details.openLinkReady ?? existing.openLinkReady
    })
    renderProjectList()
    if (selectedRepoId === id) renderDetail()
  } catch {
    /* ignore */
  }
}

function updateTerminalUI() {
  const session = activeSessionId ? sessionState.get(activeSessionId) : null
  const repoId = session?.alive ? session.repo : selectedRepoId || session?.repo
  const repo = repoId ? repos.get(repoId) : null
  if (session?.alive) {
    terminalPrompt.textContent = `${repo?.name || session.label || "session"} $`
    terminalInput.disabled = false
    terminalInput.placeholder = t("terminal.commandHint")
  } else if (repo) {
    terminalPrompt.textContent = `${repo.name} $`
    terminalInput.disabled = !repo.path
    terminalInput.placeholder = repo.path
      ? t("terminal.commandHint")
      : t("terminal.pathUnavailable")
  } else {
    terminalPrompt.textContent = "$"
    terminalInput.disabled = true
    terminalInput.placeholder = t("terminal.selectProject")
  }
  stopBtn.disabled = !(session && session.alive)
}

async function runScript(id, script) {
  const result = await api(`/api/repos/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify({ script })
  })
  if (result.sessionId) {
    activeSessionId = result.sessionId
    ensureSession(result.sessionId, id, result.label || script)
    if (terminalCollapsed) {
      terminalCollapsed = false
      applyTerminalState()
    }
    renderSessionTabs()
    renderLogBuffer()
    updateTerminalUI()
    syncRepoRunningState(id)
    if (selectedRepoId === id) updateScriptRowsForRepo(id)
    scheduleOpenLinkPoll(id)
  }
}

async function pauseScript(id, script) {
  const session = getScriptSession(id, script, { aliveOnly: true })
  if (!session) return
  await api(`/api/sessions/${encodeURIComponent(session.id)}/stop`, {
    method: "POST",
    body: "{}"
  })
  session.alive = false
  syncRepoRunningState(id)
  updateScriptRowsForRepo(id)
}

async function restartScript(id, script) {
  const session = getScriptSession(id, script, { aliveOnly: true })
  if (session?.alive) {
    await pauseScript(id, script)
    await new Promise((r) => setTimeout(r, 400))
  }
  await runScript(id, script)
}

let draggedScript = null
let draggedScriptRepo = null
let scriptsDnDBound = false

function initScriptsDnD() {
  if (scriptsDnDBound) return
  scriptsDnDBound = true

  detailContent.addEventListener("dragstart", (e) => {
    const row = e.target.closest(".script-row[data-script]")
    if (!row) return
    const panel = row.closest(".scripts-panel")
    draggedScript = row.dataset.script
    draggedScriptRepo = panel?.dataset.repoId || selectedRepoId
    row.classList.add("dragging")
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", draggedScript)
  })

  detailContent.addEventListener("dragend", (e) => {
    const row = e.target.closest(".script-row")
    row?.classList.remove("dragging")
    detailContent
      .querySelectorAll(".script-row.drag-over")
      .forEach((el) => el.classList.remove("drag-over"))
    draggedScript = null
    draggedScriptRepo = null
  })

  detailContent.addEventListener("dragover", (e) => {
    const row = e.target.closest(".script-row[data-script]")
    if (!row || !draggedScript || row.dataset.script === draggedScript) return
    e.preventDefault()
    detailContent.querySelectorAll(".script-row.drag-over").forEach((el) => {
      if (el !== row) el.classList.remove("drag-over")
    })
    row.classList.add("drag-over")
  })

  detailContent.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".script-row")
    if (row && !row.contains(e.relatedTarget)) row.classList.remove("drag-over")
  })

  detailContent.addEventListener("drop", async (e) => {
    const row = e.target.closest(".script-row[data-script]")
    if (!row || !draggedScript || !draggedScriptRepo) return
    e.preventDefault()
    row.classList.remove("drag-over")
    const targetScript = row.dataset.script
    if (!targetScript || targetScript === draggedScript) return

    const repo = repos.get(draggedScriptRepo)
    if (!repo) return
    const draggedGroup = row.dataset.group || "run"
    const sourceGroup = detailContent.querySelector(
      `.script-row[data-script="${CSS.escape(draggedScript)}"]`
    )?.dataset.group
    if (sourceGroup && draggedGroup !== sourceGroup) return

    const groups = normalizeScriptOrder(repo)
    const order = draggedGroup === "util" ? [...groups.util] : [...groups.run]
    const from = order.indexOf(draggedScript)
    const to = order.indexOf(targetScript)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, draggedScript)

    const body =
      draggedGroup === "util" ? { run: groups.run, util: order } : { run: order, util: groups.util }

    try {
      const data = await api(`/api/repos/${encodeURIComponent(draggedScriptRepo)}/script-order`, {
        method: "PUT",
        body: JSON.stringify(body)
      })
      scriptOrder[draggedScriptRepo] = data.scriptOrder || body
      repo.scriptOrder = scriptOrder[draggedScriptRepo]
      renderDetail()
      renderProjectList()
    } catch {
      renderDetail()
    }
  })
}

async function gitPull(id) {
  await api(`/api/repos/${encodeURIComponent(id)}/pull`, { method: "POST", body: "{}" })
  await refreshRepoGit(id)
}

async function gitFetch(id) {
  await api(`/api/repos/${encodeURIComponent(id)}/fetch`, { method: "POST", body: "{}" })
}

async function openFolder(id) {
  const repo = repos.get(id)
  if (!repo?.path) return
  await api("/api/explorer", { method: "POST", body: JSON.stringify({ path: repo.path }) })
  showToast(t("toast.folderOpened"))
}

async function openIde(id) {
  const repo = repos.get(id)
  if (!repo?.path) return
  await api(`/api/repos/${encodeURIComponent(id)}/ide`, { method: "POST", body: "{}" })
  showToast(t("toast.ideOpened"))
}

function openGithub(id) {
  const repo = repos.get(id)
  if (!repo?.githubUrl) return
  window.open(repo.githubUrl, "_blank", "noopener")
  showToast(t("toast.githubOpened"))
}

function markPendingVisibility(id, enabled) {
  const repo = repos.get(id)
  const ids = new Set([id])
  if (repo?.rootPath) {
    const pathKey = repo.rootPath.replace(/\\/g, "/").toLowerCase()
    for (const entry of repos.values()) {
      if (entry.rootPath?.replace(/\\/g, "/").toLowerCase() === pathKey) ids.add(entry.id)
    }
  }
  if (enabled) {
    for (const entryId of ids) {
      pendingShownIds.add(entryId)
      pendingHiddenIds.delete(entryId)
      const entry = repos.get(entryId)
      if (entry) repos.set(entryId, { ...entry, enabled: true })
    }
  } else {
    for (const entryId of ids) {
      pendingHiddenIds.add(entryId)
      pendingShownIds.delete(entryId)
      const entry = repos.get(entryId)
      if (entry) repos.set(entryId, { ...entry, enabled: false })
    }
  }
}

async function hideRepo(id) {
  const repo = repos.get(id)
  markPendingVisibility(id, false)
  if (selectedRepoId === id) selectedRepoId = null
  renderAll()
  try {
    await api(`/api/repos/${encodeURIComponent(id)}/hide`, {
      method: "POST",
      body: "{}"
    })
    showToast(t("toast.projectHidden", { name: repo?.name || id }))
  } catch (err) {
    pendingHiddenIds.delete(id)
    pendingShownIds.delete(id)
    const current = repos.get(id)
    if (current) repos.set(id, { ...current, enabled: true })
    renderAll()
    showToast(err.message || t("toast.projectHideError"), { type: "error" })
  }
}

async function showRepo(id) {
  const repo = repos.get(id)
  markPendingVisibility(id, true)
  if (!getHiddenRepos().length) showHiddenOnly = false
  renderAll()
  try {
    const data = await api(`/api/repos/${encodeURIComponent(id)}/show`, {
      method: "POST",
      body: "{}"
    })
    const current = repos.get(id)
    if (current) repos.set(id, { ...current, ...(data.repo || {}), enabled: true })
    showToast(t("toast.projectRestored", { name: repo?.name || id }))
  } catch (err) {
    pendingShownIds.delete(id)
    pendingHiddenIds.delete(id)
    const current = repos.get(id)
    if (current) repos.set(id, { ...current, enabled: false })
    renderAll()
    showToast(err.message || t("toast.projectRestoreError"), { type: "error" })
  }
}

async function unregisterRepo(id) {
  const repo = repos.get(id)
  if (!confirm(t("context.deleteProjectConfirm"))) return
  await api(`/api/repos/${encodeURIComponent(id)}`, { method: "DELETE" })
  if (selectedRepoId === id) {
    selectedRepoId = null
    applyDetailState()
  }
  await loadRepos()
  showToast(t("toast.projectDeleted", { name: repo?.name || id }))
}

function connectSSE() {
  const es = new EventSource("/api/events")

  es.addEventListener("log", (e) => {
    try {
      onLogEntry(JSON.parse(e.data))
    } catch {
      /* ignore */
    }
  })

  es.addEventListener("session", (e) => {
    try {
      onSessionEvent(JSON.parse(e.data))
    } catch {
      /* ignore */
    }
  })

  es.addEventListener("projects-changed", () => {
    if (projectsReloadTimer) clearTimeout(projectsReloadTimer)
    projectsReloadTimer = window.setTimeout(() => {
      projectsReloadTimer = null
      loadRepos().catch(() => {})
    }, 300)
  })

  es.addEventListener("repo-update", (e) => {
    try {
      const payload = JSON.parse(e.data)
      if (payload.created) {
        stopStartingDots()
        loadRepos()
          .then(() => {
            if (payload.repo?.id) selectRepo(payload.repo.id)
          })
          .catch(() => {})
        return
      }
      const { name } = payload
      if ([...sessionState.values()].some((s) => s.repo === name)) {
        syncRepoRunningState(name)
        return
      }
      refreshRepoGit(name).catch(() => {})
    } catch {
      /* ignore */
    }
  })
}

async function addProject() {
  openCreateProject()
}

window.runScript = runScript
window.pauseScript = pauseScript
window.restartScript = restartScript
window.removeMissingProject = removeMissingProject
window.gitPull = gitPull
window.gitFetch = gitFetch
window.openFolder = openFolder
window.openIde = openIde
window.openGithub = openGithub
window.hideRepo = hideRepo
window.showRepo = showRepo
window.openProjectMenu = openProjectMenu
window.unregisterRepo = unregisterRepo

function showBusyOverlay(message) {
  const overlay = document.getElementById("busy-overlay")
  const msg = document.getElementById("busy-overlay-msg")
  if (msg) msg.textContent = message || ""
  overlay?.classList.remove("hidden")
}

function hideBusyOverlay() {
  document.getElementById("busy-overlay")?.classList.add("hidden")
}

document.getElementById("terminal-refresh")?.addEventListener("click", () => loadRepos())
document.getElementById("restart-btn").addEventListener("click", async () => {
  if (!confirm(t("confirm.restartDashboard"))) return
  showBusyOverlay(t("confirm.restarting"))
  try {
    await api("/api/restart", { method: "POST", body: "{}" })
    location.reload()
  } catch (err) {
    hideBusyOverlay()
    alert(err.message || t("confirm.serverDown"))
  }
})
document.getElementById("terminal-maximize")?.addEventListener("click", (e) => {
  e.stopPropagation()
  toggleTerminalMaximized()
})
document.getElementById("terminal-close-all")?.addEventListener("click", async (e) => {
  e.stopPropagation()
  await closeAllSessions()
})
document.getElementById("list-sort-btn")?.addEventListener("click", (e) => {
  e.stopPropagation()
  openPickerMenu(
    e.currentTarget,
    getSortOptions().map((o) => ({ ...o, active: o.value === listSort })),
    (value) => {
      listSort = value
      api("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({ listSort })
      }).catch(() => {})
      renderProjectList()
    }
  )
})
document.getElementById("filter-running")?.addEventListener("click", () => {
  listFilters = { ...listFilters, running: !listFilters.running }
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ listFilters })
  }).catch(() => {})
  renderProjectList()
})
document.getElementById("filter-dirty")?.addEventListener("click", () => {
  listFilters = { ...listFilters, dirty: !listFilters.dirty }
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ listFilters })
  }).catch(() => {})
  renderProjectList()
})
document.getElementById("filter-clear")?.addEventListener("click", () => {
  listFilters = { running: false, dirty: false }
  searchQuery = ""
  searchInput.value = ""
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ listFilters })
  }).catch(() => {})
  renderProjectList()
})
document.getElementById("list-view-toggle")?.addEventListener("click", () => {
  listView = listView === "table" ? "cards" : "table"
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ listView })
  }).catch(() => {})
  renderProjectList()
})
function getMostRecentRepoId() {
  const sorted = Object.entries(recentProjects).sort((a, b) => b[1] - a[1])
  for (const [id] of sorted) {
    if (repos.has(id)) return id
  }
  return null
}

document.getElementById("detail-toggle")?.addEventListener("click", async () => {
  if (!selectedRepoId) {
    const recentId = getMostRecentRepoId()
    if (!recentId) return
    selectRepo(recentId)
    if (!detailCollapsed) return
    await openDetailPanel()
    return
  }
  if (detailCollapsed) await openDetailPanel()
  else await closeDetailPanel({ keepClosed: true })
})
document.getElementById("add-project-btn").addEventListener("click", addProject)
document.getElementById("hidden-btn").addEventListener("click", () => {
  showHiddenOnly = !showHiddenOnly
  renderAll()
  if (!showHiddenOnly) hydrateGitForVisible()
})
document.getElementById("brand-btn").addEventListener("click", () => {
  if (homePath) api("/api/explorer", { method: "POST", body: JSON.stringify({ path: homePath }) })
})
document.getElementById("settings-btn").addEventListener("click", () => openSettings())

const settingsOverlay = document.getElementById("settings-overlay")
const categoriesList = document.getElementById("categories-list")
const categoryAddInput = document.getElementById("category-add-input")
const categoriesUsePrefixes = document.getElementById("categories-use-prefixes")
const settingHomePath = document.getElementById("setting-home-path")
const settingProjectsJson = document.getElementById("setting-projects-json")
const settingsStatus = document.getElementById("settings-status")
const createProjectOverlay = document.getElementById("create-project-overlay")
const createProjectCategory = document.getElementById("create-project-category")
const createProjectName = document.getElementById("create-project-name")
const createProjectRepo = document.getElementById("create-project-repo")
const createProjectDirHint = document.getElementById("create-project-dir-hint")
const createProjectStatus = document.getElementById("create-project-status")
const createMethodTabs = document.getElementById("create-method-tabs")

let settingsSaving = false
let categoriesLoadedStrip = false
let draggedCategoryTag = null
let categoriesDnDBound = false
let createProjectMethod = "folder"

function joinProjectsJsonPath(home) {
  const trimmed = home.replace(/[\\/]+$/, "")
  const sep = trimmed.includes("\\") ? "\\" : "/"
  return `${trimmed}${sep}projects.json`
}

function setSettingsStatus(msg, isError = false) {
  if (!settingsStatus) return
  settingsStatus.textContent = msg || ""
  settingsStatus.style.color = isError ? "var(--error)" : "var(--accent)"
}

async function loadSettingsForm() {
  const data = await api("/api/settings")
  settingHomePath.value = data.homePath || ""
  settingProjectsJson.value = data.projectsJsonPath || ""
  categoriesUsePrefixes.checked = !data.stripNumbersInJson
  categoriesLoadedStrip = !!data.stripNumbersInJson
  stripNumbersInJson = !!data.stripNumbersInJson
  if (data.tags) tags = data.tags
  if (data.tagIcons) tagIcons = data.tagIcons
  renderCategoriesList()
  setSettingsStatus("")
}

async function loadCategoriesForm() {
  await loadSettingsForm()
}

async function saveSettingsForm(partial = {}) {
  if (settingsSaving) return
  settingsSaving = true
  setSettingsStatus(t("settings.saving"))
  try {
    const body = {
      homePath: settingHomePath.value.trim(),
      projectsJsonPath: settingProjectsJson.value.trim(),
      ...partial
    }
    const data = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) })
    if (data.homePath) homePath = data.homePath
    if (data.tags) tags = data.tags
    if (data.tagIcons) tagIcons = data.tagIcons
    setSettingsStatus(t("settings.saved"))
    renderAll()
    setTimeout(() => setSettingsStatus(""), 1500)
  } catch (err) {
    setSettingsStatus(err.message, true)
  } finally {
    settingsSaving = false
  }
}

async function saveCategoriesSettings(partial = {}) {
  if (settingsSaving) return
  settingsSaving = true
  try {
    const body = {
      stripNumbersInJson: !categoriesUsePrefixes.checked,
      homePath: homePath || settingHomePath?.value?.trim() || "",
      projectsJsonPath: settingProjectsJson?.value?.trim() || "",
      ...partial
    }
    const data = await api("/api/settings", { method: "PUT", body: JSON.stringify(body) })
    stripNumbersInJson = !!data.stripNumbersInJson
    categoriesLoadedStrip = !!data.stripNumbersInJson
    if (data.tags) tags = data.tags
    if (data.tagIcons) tagIcons = data.tagIcons
    renderCategoriesList()
    renderAll()
  } catch (err) {
    alert(err.message)
  } finally {
    settingsSaving = false
  }
}

function renderCategoriesList() {
  if (!categoriesList) return
  const realTags = tags.filter((t) => t !== UNCATEGORIZED_KEY)
  if (!realTags.length) {
    categoriesList.innerHTML = `<p class="categories-empty">${escapeHtml(t("categories.empty"))}</p>`
    return
  }
  categoriesList.innerHTML = realTags
    .map((tag) => {
      const label = parseTagDisplay(tag).label
      const icon = getCategoryIcon(tag)
      return `<div class="categories-row" data-tag="${escapeHtml(tag)}">
        <span class="categories-drag" draggable="true" title="${escapeHtml(t("sidebar.drag"))}"><i class="mdi mdi-drag-vertical"></i></span>
        <i class="mdi ${icon} categories-row-icon"></i>
        <span class="categories-row-label">${escapeHtml(label)}</span>
        <button type="button" class="categories-delete" data-tag="${escapeHtml(tag)}" title="${escapeHtml(t("categories.delete"))}">
          <i class="mdi mdi-delete-outline"></i>
        </button>
      </div>`
    })
    .join("")

  categoriesList.querySelectorAll(".categories-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation()
      const tag = btn.dataset.tag
      const label = parseTagDisplay(tag).label
      if (!confirm(t("categories.deleteConfirm", { name: label }))) return
      const data = await api("/api/tags", { method: "DELETE", body: JSON.stringify({ tag }) })
      tags = data.tags || tags
      if (activeTag === tag) activeTag = "__all__"
      await loadRepos()
      renderCategoriesList()
    })
  })
}

function initCategoriesDnD() {
  if (categoriesDnDBound || !categoriesList) return
  categoriesDnDBound = true

  categoriesList.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".categories-drag")
    if (!handle) return
    const row = handle.closest(".categories-row")
    if (!row?.dataset.tag) return
    draggedCategoryTag = row.dataset.tag
    row.classList.add("dragging")
    e.dataTransfer.effectAllowed = "move"
  })

  categoriesList.addEventListener("dragend", (e) => {
    e.target.closest(".categories-row")?.classList.remove("dragging")
    categoriesList.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"))
    draggedCategoryTag = null
  })

  categoriesList.addEventListener("dragover", (e) => {
    const row = e.target.closest(".categories-row")
    if (!row?.dataset.tag || !draggedCategoryTag || row.dataset.tag === draggedCategoryTag) return
    e.preventDefault()
    categoriesList.querySelectorAll(".drag-over").forEach((el) => {
      if (el !== row) el.classList.remove("drag-over")
    })
    row.classList.add("drag-over")
  })

  categoriesList.addEventListener("drop", async (e) => {
    const row = e.target.closest(".categories-row")
    if (!row?.dataset.tag || !draggedCategoryTag) return
    e.preventDefault()
    row.classList.remove("drag-over")
    const targetTag = row.dataset.tag
    const order = tags.filter((t) => t !== UNCATEGORIZED_KEY)
    const from = order.indexOf(draggedCategoryTag)
    const to = order.indexOf(targetTag)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, draggedCategoryTag)
    const uncat = tags.includes(UNCATEGORIZED_KEY) ? [UNCATEGORIZED_KEY] : []
    const data = await api("/api/tags/order", {
      method: "PUT",
      body: JSON.stringify({ tags: [...order, ...uncat] })
    })
    tags = data.tags || [...order, ...uncat]
    await loadRepos()
    renderCategoriesList()
  })
}

function openSettings() {
  loadSettingsForm().catch((err) => setSettingsStatus(err.message, true))
  settingsOverlay.classList.remove("hidden")
  initCategoriesDnD()
}

function closeSettings() {
  settingsOverlay.classList.add("hidden")
}

function setCreateProjectStatus(msg, isError = false) {
  if (!createProjectStatus) return
  createProjectStatus.textContent = msg || ""
  createProjectStatus.style.color = isError ? "var(--error)" : "var(--muted)"
}

function getCreatableTags() {
  return tags.filter((t) => t !== UNCATEGORIZED_KEY)
}

function resolveDefaultCreateTag() {
  if (activeTag !== "__all__" && activeTag !== UNCATEGORIZED_KEY) {
    const creatable = getCreatableTags()
    if (creatable.includes(activeTag)) return activeTag
  }
  const creatable = getCreatableTags()
  return creatable[0] || UNCATEGORIZED_KEY
}

async function refreshCreateCategoryDir() {
  const tag = createProjectCategory?.value
  if (!tag || !createProjectDirHint) {
    if (createProjectDirHint) createProjectDirHint.textContent = ""
    return
  }
  try {
    const data = await api(`/api/category-dir?tag=${encodeURIComponent(tag)}`)
    const hint = data.exists === false ? t("create.targetDirNew", { dir: data.dir }) : t("create.targetDir", { dir: data.dir })
    createProjectDirHint.textContent = hint
  } catch {
    createProjectDirHint.textContent =
      tag === UNCATEGORIZED_KEY ? t("create.noHomePath") : t("create.noCategoryDir")
  }
}

function populateCreateCategories() {
  if (!createProjectCategory) return
  const creatable = getCreatableTags()
  const selected = resolveDefaultCreateTag()
  const options = [
    `<option value="${UNCATEGORIZED_KEY}"${selected === UNCATEGORIZED_KEY ? " selected" : ""}>${escapeHtml(t("create.uncategorized"))}</option>`
  ]
  for (const tag of creatable) {
    const label = parseTagDisplay(tag).label
    const sel = tag === selected ? " selected" : ""
    options.push(`<option value="${escapeHtml(tag)}"${sel}>${escapeHtml(label)}</option>`)
  }
  createProjectCategory.innerHTML = options.join("")
  refreshCreateCategoryDir()
}

function updateCreateMethodUI() {
  const isClone = createProjectMethod === "clone"
  document.querySelector(".create-field-name")?.classList.remove("hidden")
  document.querySelector(".create-field-clone")?.classList.toggle("hidden", !isClone)
  const submit = document.getElementById("create-project-submit")
  if (submit) submit.textContent = t("create.create")
}

function openCreateProject() {
  createProjectMethod = "folder"
  createMethodTabs?.querySelectorAll(".create-method-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.method === createProjectMethod)
  })
  if (createProjectName) createProjectName.value = ""
  if (createProjectRepo) createProjectRepo.value = ""
  const createCategoryNew = document.getElementById("create-category-new")
  if (createCategoryNew) createCategoryNew.value = ""
  setCreateProjectStatus("")
  populateCreateCategories()
  updateCreateMethodUI()
  createProjectOverlay?.classList.remove("hidden")
}

function closeCreateProject() {
  createProjectOverlay?.classList.add("hidden")
}

async function submitCreateProject() {
  const tag = createProjectCategory?.value
  if (!tag) {
    setCreateProjectStatus(t("create.categoryRequired"), true)
    return
  }
  setCreateProjectStatus("")
  try {
    const name = createProjectName?.value?.trim() || ""
    if (!name) {
      setCreateProjectStatus(t("create.nameRequired"), true)
      return
    }

    const body = {
      method: createProjectMethod,
      tag,
      name,
      repoUrl: createProjectRepo?.value?.trim() || ""
    }
    const data = await api("/api/repos/create", { method: "POST", body: JSON.stringify(body) })

    if (data.repo?.id) {
      await loadRepos()
      selectRepo(data.repo.id)
      closeCreateProject()
      showToast(t("toast.projectCreated", { name: data.repo.name || name }))
    }
  } catch (err) {
    const key =
      err.message === "categoryDirNotFound"
        ? t("create.noCategoryDir")
        : err.message === "homePathNotFound"
          ? t("create.noHomePath")
          : err.message
    setCreateProjectStatus(key, true)
  }
}

document.getElementById("settings-close")?.addEventListener("click", closeSettings)
document.getElementById("settings-reset-btn")?.addEventListener("click", async () => {
  if (!confirm(t("settings.resetConfirm"))) return
  closeSettings()
  showBusyOverlay(t("settings.resetting"))
  try {
    localStorage.removeItem("dock-term-body-h")
    localStorage.removeItem("locale")
    const data = await api("/api/settings/reset", { method: "POST", body: "{}" })
    location.replace(data.redirect || "/onboarding.html")
  } catch (err) {
    hideBusyOverlay()
    alert(err.message || t("settings.resetFailed"))
  }
})
settingsOverlay?.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) closeSettings()
})

document.getElementById("create-project-close")?.addEventListener("click", closeCreateProject)
document.getElementById("create-project-cancel")?.addEventListener("click", closeCreateProject)
document.getElementById("create-project-submit")?.addEventListener("click", submitCreateProject)
createProjectOverlay?.addEventListener("click", (e) => {
  if (e.target === createProjectOverlay) closeCreateProject()
})
createProjectCategory?.addEventListener("change", refreshCreateCategoryDir)

document.getElementById("create-category-add-btn")?.addEventListener("click", async () => {
  const input = document.getElementById("create-category-new")
  const name = input?.value?.trim()
  if (!name) return
  try {
    const data = await api("/api/tags", { method: "POST", body: JSON.stringify({ name }) })
    tags = data.tags || tags
    if (data.tagIcons) tagIcons = data.tagIcons
    if (input) input.value = ""
    renderSidebar()
    populateCreateCategories()
    if (data.tag && createProjectCategory) createProjectCategory.value = data.tag
    setCreateProjectStatus("")
    refreshCreateCategoryDir()
  } catch (err) {
    setCreateProjectStatus(err.message, true)
  }
})

document.getElementById("create-category-new")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("create-category-add-btn")?.click()
})

createMethodTabs?.querySelectorAll(".create-method-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    createProjectMethod = btn.dataset.method || "folder"
    createMethodTabs.querySelectorAll(".create-method-tab").forEach((b) => {
      b.classList.toggle("active", b === btn)
    })
    updateCreateMethodUI()
  })
})

document.getElementById("category-add-btn")?.addEventListener("click", async () => {
  const name = categoryAddInput?.value?.trim()
  if (!name) return
  try {
    const data = await api("/api/tags", { method: "POST", body: JSON.stringify({ name }) })
    tags = data.tags || tags
    if (data.tagIcons) tagIcons = data.tagIcons
    categoryAddInput.value = ""
    await loadRepos()
    renderCategoriesList()
  } catch (err) {
    alert(err.message)
  }
})

categoryAddInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("category-add-btn")?.click()
})

categoriesUsePrefixes?.addEventListener("change", () => {
  const enablingPrefixes = categoriesUsePrefixes.checked
  if (enablingPrefixes && categoriesLoadedStrip) {
    if (!confirm(t("categories.usePrefixesEnable"))) {
      categoriesUsePrefixes.checked = false
      return
    }
  }
  if (!enablingPrefixes && !categoriesLoadedStrip) {
    if (!confirm(t("categories.usePrefixesDisable"))) {
      categoriesUsePrefixes.checked = true
      return
    }
  }
  saveCategoriesSettings()
})

settingHomePath?.addEventListener("change", async () => {
  if (!settingProjectsJson.dataset.manual) {
    settingProjectsJson.value = joinProjectsJsonPath(settingHomePath.value)
  }
  await saveSettingsForm()
})

settingProjectsJson?.addEventListener("input", () => {
  settingProjectsJson.dataset.manual = "1"
})

settingProjectsJson?.addEventListener("change", () => saveSettingsForm())

document.getElementById("setting-pick-home")?.addEventListener("click", async () => {
  try {
    const result = await api("/api/onboarding/pick-folder", { method: "POST", body: "{}" })
    if (!result.cancelled && result.path) {
      settingHomePath.value = result.path
      settingProjectsJson.value = joinProjectsJsonPath(result.path)
      settingProjectsJson.dataset.manual = ""
      await saveSettingsForm()
    }
  } catch (err) {
    setSettingsStatus(err.message, true)
  }
})

document.getElementById("setting-pick-json")?.addEventListener("click", async () => {
  try {
    const result = await api("/api/onboarding/pick-file", {
      method: "POST",
      body: JSON.stringify({ title: t("settings.pickProjectsJson") })
    })
    if (!result.cancelled && result.path) {
      settingProjectsJson.value = result.path
      settingProjectsJson.dataset.manual = "1"
      await saveSettingsForm()
    }
  } catch {
    setSettingsStatus(t("settings.filePickerWindowsOnly"), true)
  }
})

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return
  if (!createProjectOverlay?.classList.contains("hidden")) closeCreateProject()
  else if (!settingsOverlay?.classList.contains("hidden")) closeSettings()
})
document.getElementById("sidebar-toggle").addEventListener("click", () => {
  sidebarCollapsed = !sidebarCollapsed
  applySidebarState()
  saveSidebarPrefs()
})

document.getElementById("terminal-toggle").addEventListener("click", (e) => {
  e.stopPropagation()
  toggleTerminalCollapsed()
})

searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value
  renderProjectList()
})

terminalForm.addEventListener("submit", async (e) => {
  e.preventDefault()
  const session = activeSessionId ? sessionState.get(activeSessionId) : null
  if (session?.alive) {
    const text = terminalInput.value
    terminalInput.value = ""
    await api(`/api/sessions/${encodeURIComponent(session.id)}/stdin`, {
      method: "POST",
      body: JSON.stringify({ data: `${text}\r` })
    }).catch(() => {})
    return
  }
  const repoId = selectedRepoId || session?.repo
  if (!repoId || terminalInput.disabled) return
  const command = terminalInput.value.trim()
  if (!command) return
  terminalInput.value = ""
  await api(`/api/repos/${encodeURIComponent(repoId)}/exec`, {
    method: "POST",
    body: JSON.stringify({ command })
  })
})

function bindTerminalKeys() {
  const sendKey = async (data) => {
    const session = activeSessionId ? sessionState.get(activeSessionId) : null
    if (!session?.alive) return false
    await api(`/api/sessions/${encodeURIComponent(session.id)}/stdin`, {
      method: "POST",
      body: JSON.stringify({ data })
    }).catch(() => {})
    return true
  }

  terminalInput.addEventListener("keydown", async (e) => {
    const session = activeSessionId ? sessionState.get(activeSessionId) : null
    if (!session?.alive) return
    const map = {
      ArrowUp: "\x1b[A",
      ArrowDown: "\x1b[B",
      ArrowRight: "\x1b[C",
      ArrowLeft: "\x1b[D",
      Tab: "\t",
      Escape: "\x1b",
      Enter: "\r"
    }
    if (map[e.key]) {
      e.preventDefault()
      await sendKey(map[e.key])
    }
  })
}

bindTerminalKeys()

stopBtn.addEventListener("click", async () => {
  if (!activeSessionId) return
  const session = sessionState.get(activeSessionId)
  await api(`/api/sessions/${encodeURIComponent(activeSessionId)}/stop`, {
    method: "POST",
    body: "{}"
  })
  if (session) session.alive = false
  if (session?.repo) {
    syncRepoRunningState(session.repo)
    updateScriptRowsForRepo(session.repo)
  }
})

connectSSE()
initSidebarDnD()
bindProjectListDnD()
initTerminalResize()
initDetailResize()
initSidebarResize()
document.documentElement.style.setProperty("--term-body-h", `${terminalBodyHeight}px`)
applySidebarState()
applyDetailState()

window.onLocaleChange = () => {
  renderAll()
  applyTerminalState()
  I18n.applyStatic()
}

document.getElementById("lang-toggle")?.addEventListener("click", async () => {
  const next = I18n.locale === "ru" ? "en" : "ru"
  await I18n.setLocale(next)
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ locale: next })
  }).catch(() => {})
})

async function boot() {
  await I18n.init()
  try {
    await loadRepos()
  } catch (err) {
    projectList.innerHTML = `<div class="empty-state">${escapeHtml(err.message)}</div>`
  }
}

boot()
