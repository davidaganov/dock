const { URL } = require("url")
const { getRepoSessions, getSession, isPortOpen } = require("./processes")

const PORT_PATTERNS = [
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d+)/i,
  /\blocal:\s*https?:\/\/[^:\s]+:(\d+)/i,
  /\bnetwork:\s*https?:\/\/[^:\s]+:(\d+)/i,
  /listening\s+(?:on|at)\s+[^\d]*(\d{2,5})/i
]

const portFromLogs = (buffer) => {
  if (!buffer?.length) return null
  for (let i = buffer.length - 1; i >= 0; i--) {
    const msg = buffer[i]?.message || ""
    for (const re of PORT_PATTERNS) {
      const m = re.exec(msg)
      if (m) {
        const port = parseInt(m[1], 10)
        if (port > 0 && port < 65536) return port
      }
    }
  }
  return null
}

const resolveOpenLinkReady = async (openLink, projectId) => {
  if (!openLink?.url) return { ready: false, openLink: null }

  const base = new URL(openLink.url)
  const configuredPort = parseInt(base.port, 10)
  const portsToTry = []

  if (configuredPort > 0) portsToTry.push(configuredPort)

  for (const sess of getRepoSessions(projectId)) {
    const full = getSession(sess.id)
    const fromLogs = portFromLogs(full?.buffer)
    if (fromLogs && !portsToTry.includes(fromLogs)) portsToTry.push(fromLogs)
  }

  for (const port of portsToTry) {
    if (!(await isPortOpen(port))) continue
    const next = new URL(openLink.url)
    next.port = String(port)
    const url = next.href.replace(/\/$/, "") || next.href
    return { ready: true, openLink: { ...openLink, url } }
  }

  return { ready: false, openLink }
}

module.exports = { resolveOpenLinkReady, portFromLogs }
