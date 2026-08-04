const fs = require("fs")
const path = require("path")
const { SKIP_SCAN_DIRS } = require("../core/constants")

const folderHints = (dirPath) => {
  let hasGit = false
  let hasPackageJson = false
  try {
    hasGit = fs.existsSync(path.join(dirPath, ".git"))
    hasPackageJson = fs.existsSync(path.join(dirPath, "package.json"))
  } catch {
    // Inaccessible folders are reported without project hints.
  }
  return { hasGit, hasPackageJson }
}

const scanFolderTree = (rootDir, maxDepth = 5, depth = 0) => {
  if (!rootDir || !fs.existsSync(rootDir) || depth > maxDepth) return null

  let stat
  try {
    stat = fs.statSync(rootDir)
  } catch {
    return null
  }
  if (!stat.isDirectory()) return null

  const resolved = path.resolve(rootDir)
  const hints = folderHints(resolved)
  const node = {
    name: path.basename(resolved) || resolved,
    path: resolved,
    depth,
    ...hints,
    childCount: 0,
    children: []
  }

  const isProjectRoot = hints.hasGit || hints.hasPackageJson
  if (isProjectRoot || depth >= maxDepth) return node

  let entries
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
  } catch {
    return node
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith(".")) continue
    if (SKIP_SCAN_DIRS.has(entry.name)) continue

    const child = scanFolderTree(path.join(resolved, entry.name), maxDepth, depth + 1)
    if (child) node.children.push(child)
  }

  node.childCount = node.children.length
  return node
}

const flattenFolderTree = (node, list = []) => {
  if (!node) return list
  list.push({
    name: node.name,
    path: node.path,
    depth: node.depth,
    hasGit: node.hasGit,
    hasPackageJson: node.hasPackageJson,
    childCount: node.children.length
  })
  for (const child of node.children) {
    flattenFolderTree(child, list)
  }
  return list
}

const collectSelectedProjects = (tree, selectedPaths, tagByRoot = {}) => {
  const selected = new Set(
    selectedPaths.map((p) => path.resolve(p).replace(/\\/g, "/").toLowerCase())
  )
  const items = []

  const walk = (node, inheritedTag) => {
    if (!node) return
    const key = node.path.replace(/\\/g, "/").toLowerCase()
    const tag = tagByRoot[node.path] || inheritedTag || ""

    if (selected.has(key)) {
      items.push({
        path: node.path,
        name: node.name,
        tags: tag ? [tag] : []
      })
    }

    for (const child of node.children) {
      walk(child, tag || inheritedTag)
    }
  }

  walk(tree, "")
  return items
}

const inferTagFromPath = (projectPath, homePath) => {
  const home = path.resolve(homePath)
  const rel = path.relative(home, path.resolve(projectPath))
  if (!rel || rel.startsWith("..")) return ""
  const first = rel.split(path.sep)[0]
  return first || ""
}

module.exports = {
  scanFolderTree,
  flattenFolderTree,
  collectSelectedProjects,
  inferTagFromPath,
  folderHints
}
