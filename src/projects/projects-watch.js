const fs = require("fs")
const path = require("path")
const { getProjectsJsonPath } = require("../config/config")
const { broadcast } = require("../runtime/sse")

let watcher = null
let debounceTimer = null
let suppressUntil = 0
let lastMtimeMs = 0
let watchedPath = ""

const suppressProjectsWatch = (ms = 800) => {
  suppressUntil = Date.now() + ms
}

const notifyProjectsChanged = () => {
  broadcast("projects-changed", { path: getProjectsJsonPath(), at: Date.now() })
}

const onProjectsFileEvent = () => {
  if (Date.now() < suppressUntil) return

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (Date.now() < suppressUntil) return
    const filePath = getProjectsJsonPath()
    try {
      if (!fs.existsSync(filePath)) {
        notifyProjectsChanged()
        return
      }
      const mtimeMs = fs.statSync(filePath).mtimeMs
      if (mtimeMs === lastMtimeMs) return
      lastMtimeMs = mtimeMs
    } catch {
      // Still notify so the UI can recover from a temporarily unreadable file.
    }
    notifyProjectsChanged()
  }, 250)
}

const stopProjectsWatch = () => {
  if (watcher) {
    watcher.close()
    watcher = null
  }
  watchedPath = ""
  clearTimeout(debounceTimer)
  debounceTimer = null
}

const startProjectsWatch = () => {
  const filePath = getProjectsJsonPath()
  if (!filePath) return
  if (watcher && watchedPath === filePath) return

  stopProjectsWatch()
  watchedPath = filePath

  try {
    if (fs.existsSync(filePath)) {
      lastMtimeMs = fs.statSync(filePath).mtimeMs
    }
  } catch {
    lastMtimeMs = 0
  }

  const dir = path.dirname(filePath)
  const base = path.basename(filePath)

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    watcher = fs.watch(dir, { persistent: true }, (_eventType, filename) => {
      if (!filename) {
        onProjectsFileEvent()
        return
      }
      const name = filename.toString()
      if (name === base || name === `${base}.tmp` || name === `${base}.bak`) {
        onProjectsFileEvent()
      }
    })
    watcher.on("error", () => {
      stopProjectsWatch()
      setTimeout(startProjectsWatch, 1000)
    })
  } catch {
    // Directory may be unavailable during onboarding; retry later.
    setTimeout(startProjectsWatch, 2000)
  }
}

module.exports = {
  startProjectsWatch,
  stopProjectsWatch,
  suppressProjectsWatch,
  notifyProjectsChanged
}
