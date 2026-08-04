const fs = require("fs")
const path = require("path")
const { execFile, spawn } = require("child_process")
const { loadConfig } = require("../config/config")
const { defaultHomePath } = require("../core/paths")

const resolveExplorerPath = (requested) => {
  const config = loadConfig()
  const fallback = config.homePath || defaultHomePath()
  const target = requested ? path.resolve(String(requested)) : path.resolve(fallback)
  if (!fs.existsSync(target)) throw new Error("Path not found")
  return target
}

const openInExplorer = (targetPath) => {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      execFile("explorer.exe", [targetPath], () => resolve())
      return
    }
    if (process.platform === "darwin") {
      execFile("open", [targetPath], (err) => (err ? reject(err) : resolve()))
      return
    }
    execFile("xdg-open", [targetPath], (err) => (err ? reject(err) : resolve()))
  })
}

const spawnDetached = (cmd, args) => {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        shell: process.platform === "win32",
        windowsHide: true
      })
      child.on("error", reject)
      child.unref()
      resolve()
    } catch (err) {
      reject(err)
    }
  })
}

const ideCandidates = () => {
  if (process.platform === "win32") {
    return [
      { cmd: "cursor", args: (p) => [p] },
      { cmd: "code", args: (p) => [p] },
      { cmd: "code-insiders", args: (p) => [p] }
    ]
  }
  if (process.platform === "darwin") {
    return [
      { cmd: "cursor", args: (p) => [p] },
      { cmd: "code", args: (p) => [p] },
      { cmd: "open", args: (p) => ["-a", "Cursor", p] },
      { cmd: "open", args: (p) => ["-a", "Visual Studio Code", p] }
    ]
  }
  return [
    { cmd: "cursor", args: (p) => [p] },
    { cmd: "code", args: (p) => [p] }
  ]
}

const openInIde = async (targetPath) => {
  const resolved = path.resolve(targetPath)
  if (!fs.existsSync(resolved)) throw new Error("Path not found")
  const stat = fs.statSync(resolved)
  const folder = stat.isDirectory() ? resolved : path.dirname(resolved)

  let lastError = null
  for (const candidate of ideCandidates()) {
    try {
      await spawnDetached(candidate.cmd, candidate.args(folder))
      return
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(lastError?.message || "IDE not found. Install Cursor or VS Code.")
}

const pickFolderDialog = () => {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$d.Description = 'Select a folder'",
        "$d.ShowNewFolderButton = $false",
        "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }"
      ].join("; ")
      execFile(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(err)
          resolve(String(stdout || "").trim() || null)
        }
      )
      return
    }
    if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Select a folder")'],
        (err, stdout) => {
          if (err) {
            if (err.code === 1 || /User canceled/i.test(String(err.message))) return resolve(null)
            return reject(err)
          }
          resolve(
            String(stdout || "")
              .trim()
              .replace(/\/$/, "") || null
          )
        }
      )
      return
    }
    execFile(
      "zenity",
      ["--file-selection", "--directory", "--title=Select a folder"],
      (err, stdout) => {
        if (err) {
          if (err.code === 1) return resolve(null)
          return reject(new Error("Folder picker unavailable — enter the path manually"))
        }
        resolve(String(stdout || "").trim() || null)
      }
    )
  })
}

const pickFileDialog = ({ title = "Select a file", filters = null } = {}) => {
  return new Promise((resolve, reject) => {
    if (process.platform === "win32") {
      const filterClause = filters
        ? `$d.Filter = '${filters.map((f) => `${f.name}|${f.extensions.map((e) => `*.${e}`).join(";")}`).join("|")}|All files (*.*)|*.*'`
        : "$d.Filter = 'JSON files (*.json)|*.json|All files (*.*)|*.*'"
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.OpenFileDialog",
        `$d.Title = '${title.replace(/'/g, "''")}'`,
        filterClause,
        "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.FileName) }"
      ].join("; ")
      execFile(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { windowsHide: true, maxBuffer: 1024 * 1024 },
        (err, stdout) => {
          if (err) return reject(err)
          resolve(String(stdout || "").trim() || null)
        }
      )
      return
    }
    resolve(null)
  })
}

module.exports = {
  resolveExplorerPath,
  openInExplorer,
  openInIde,
  pickFolderDialog,
  pickFileDialog
}
