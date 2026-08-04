const path = require("path")
const { spawn, execFile } = require("child_process")
const net = require("net")

/** @type {Map<string, object>} */
const sessions = new Map()
/** @type {Map<string, Set<string>>} */
const repoSessions = new Map()

let sessionSeq = 0
let broadcastFn = () => {}
let logFn = () => {}

const initProcessManager = ({ broadcast, log }) => {
  broadcastFn = broadcast
  logFn = log
}

const newSessionId = () => {
  sessionSeq += 1
  return `s${Date.now()}_${sessionSeq}`
}

const spawnEnv = (cwd) => {
  const env = { ...process.env }
  delete env.NO_COLOR
  env.FORCE_COLOR = "1"
  env.COLORTERM = env.COLORTERM || "truecolor"
  env.TERM = env.TERM || "xterm-256color"
  const nodeDir = path.dirname(process.execPath)
  const delim = path.delimiter
  const parts = (env.PATH || env.Path || "").split(delim).filter(Boolean)
  if (!parts.some((p) => path.resolve(p) === path.resolve(nodeDir))) {
    parts.unshift(nodeDir)
  }
  if (cwd) {
    const localBin = path.join(cwd, "node_modules", ".bin")
    if (!parts.some((p) => path.resolve(p) === path.resolve(localBin))) {
      parts.unshift(localBin)
    }
  }
  const next = parts.join(delim)
  env.PATH = next
  if (process.platform === "win32") env.Path = next
  return env
}

const getRepoSessionIds = (repoId) => {
  return [...(repoSessions.get(repoId) || [])]
}

const getRepoSessions = (repoId) => {
  return getRepoSessionIds(repoId)
    .map((id) => sessions.get(id))
    .filter(Boolean)
    .map((s) => ({ id: s.id, label: s.label, repo: s.repo }))
}

const listAllSessions = () => {
  return [...sessions.values()].map((s) => ({ id: s.id, label: s.label, repo: s.repo }))
}

const attachSession = (session) => {
  sessions.set(session.id, session)
  if (!repoSessions.has(session.repo)) repoSessions.set(session.repo, new Set())
  repoSessions.get(session.repo).add(session.id)
  broadcastFn("session", {
    type: "start",
    sessionId: session.id,
    repo: session.repo,
    label: session.label
  })
  broadcastFn("repo-update", { name: session.repo })
}

const detachSession = (sessionId, code = null) => {
  const session = sessions.get(sessionId)
  if (!session) return

  const exitMsg = code === null ? "Process stopped" : `Process exited (code ${code})`
  const type = code === 0 ? "success" : code === null ? "warning" : "error"
  logFn(session.repo, exitMsg, type, sessionId)

  sessions.delete(sessionId)
  const set = repoSessions.get(session.repo)
  if (set) {
    set.delete(sessionId)
    if (set.size === 0) repoSessions.delete(session.repo)
  }
  broadcastFn("session", {
    type: "exit",
    sessionId,
    repo: session.repo,
    label: session.label,
    code
  })
  broadcastFn("repo-update", { name: session.repo })
}

const startProcess = (projectId, repoPath, cmd, args, { label, shellLine } = {}) => {
  const sessionId = newSessionId()
  const display = shellLine || [cmd, ...args].join(" ")
  const sessionLabel = label || display

  const env = spawnEnv(repoPath)
  const proc = shellLine
    ? spawn(shellLine, { cwd: repoPath, shell: true, env })
    : spawn(cmd, args, { cwd: repoPath, shell: true, env })

  const session = {
    id: sessionId,
    repo: projectId,
    label: sessionLabel,
    proc,
    buffer: [],
    cwd: repoPath
  }
  attachSession(session)
  logFn(projectId, `$ ${display}`, "cmd", sessionId)
  logFn(projectId, "…", "starting", sessionId, "log.processStarting")

  const shouldSkip = (text) => {
    const t = String(text || "")
    if (/^npm notice/i.test(t.trim())) return true
    if (/^npm warn exec/i.test(t.trim())) return true
    return false
  }

  proc.stdout.on("data", (d) => {
    const text = d.toString()
    if (shouldSkip(text)) return
    logFn(projectId, text, "stdout", sessionId)
  })
  proc.stderr.on("data", (d) => {
    const text = d.toString()
    if (shouldSkip(text)) return
    logFn(projectId, text, "stderr", sessionId)
  })
  proc.on("close", (code) => detachSession(sessionId, code))
  proc.on("error", (err) => {
    logFn(projectId, err.message, "error", sessionId)
    detachSession(sessionId, 1)
  })

  return { started: true, pid: proc.pid, sessionId, label: sessionLabel }
}

const writeSessionInput = (sessionId, data) => {
  const session = sessions.get(sessionId)
  if (!session?.proc?.stdin || session.proc.stdin.destroyed) return false
  try {
    session.proc.stdin.write(data)
    return true
  } catch {
    return false
  }
}

const stopSession = (sessionId) => {
  const session = sessions.get(sessionId)
  if (!session) return false
  logFn(session.repo, "Stopping process…", "warning", sessionId)
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(session.proc.pid), "/f", "/t"], { shell: true })
  } else {
    session.proc.kill("SIGTERM")
  }
  return true
}

const stopRepo = (projectId) => {
  const ids = getRepoSessionIds(projectId)
  if (!ids.length) return false
  for (const id of ids) stopSession(id)
  return true
}

const stopAllSessions = () => {
  const ids = [...sessions.keys()]
  for (const id of ids) stopSession(id)
  return ids.length
}

const getSession = (sessionId) => {
  return sessions.get(sessionId) || null
}

const isPortListening = (port, host = "127.0.0.1") => {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host })
    const finish = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(800, () => finish(false))
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })
}

const isPortOpen = async (port) => {
  if (!port || port < 1) return false
  if (await isPortListening(port, "127.0.0.1")) return true
  if (await isPortListening(port, "localhost")) return true
  return false
}

const getListeningProcessIds = (port) => {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("netstat", ["-ano", "-p", "tcp"], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
        const pids = new Set()
        if (err) return resolve(pids)
        const portSuffix = `:${port}`
        for (const line of stdout.split(/\r?\n/)) {
          if (!line.includes("LISTENING") || !line.includes(portSuffix)) continue
          const parts = line.trim().split(/\s+/)
          const pid = parseInt(parts[parts.length - 1], 10)
          if (Number.isInteger(pid) && pid > 0) pids.add(pid)
        }
        resolve(pids)
      })
      return
    }

    execFile("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], (err, stdout) => {
      const pids = new Set()
      if (err) return resolve(pids)
      for (const line of stdout.split(/\r?\n/)) {
        const pid = parseInt(line.trim(), 10)
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
      resolve(pids)
    })
  })
}

const killPort = async (port) => {
  const pids = await getListeningProcessIds(port)
  const killed = []
  const errors = []

  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        await new Promise((resolve, reject) => {
          execFile("taskkill", ["/pid", String(pid), "/f", "/t"], (err) =>
            err ? reject(err) : resolve()
          )
        })
      } else {
        process.kill(pid, "SIGTERM")
      }
      killed.push(pid)
    } catch (err) {
      errors.push({ pid, error: err.message })
    }
  }

  await new Promise((r) => setTimeout(r, 400))
  const stillListening = await isPortOpen(port)
  return { port, killed: [...pids].map(Number), stopped: killed, errors, freed: !stillListening }
}

const killAllOnShutdown = () => {
  for (const session of sessions.values()) {
    try {
      session.proc.kill("SIGTERM")
    } catch {
      // The process may have already exited during shutdown.
    }
  }
}

module.exports = {
  initProcessManager,
  startProcess,
  writeSessionInput,
  stopSession,
  stopRepo,
  stopAllSessions,
  getRepoSessions,
  listAllSessions,
  getSession,
  isPortListening,
  isPortOpen,
  killPort,
  killAllOnShutdown
}
