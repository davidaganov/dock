const fs = require("fs")
const path = require("path")

const defaultHomePath = () => {
  const home =
    process.platform === "win32"
      ? process.env.USERPROFILE || process.env.HOMEPATH
      : process.env.HOME
  if (home) return path.join(home, "projects")
  return path.join(process.cwd(), "projects")
}

const defaultProjectsJsonPath = (homePath) => {
  return path.join(homePath || defaultHomePath(), "projects.json")
}

const resolveExistingDir = (dirPath) => {
  const resolved = path.resolve(String(dirPath))
  if (!fs.existsSync(resolved)) return null
  if (!fs.statSync(resolved).isDirectory()) return null
  return resolved
}

const isPathInsideRoot = (rootPath, targetPath) => {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const rel = path.relative(root, target)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

module.exports = {
  defaultHomePath,
  defaultProjectsJsonPath,
  resolveExistingDir,
  isPathInsideRoot
}
