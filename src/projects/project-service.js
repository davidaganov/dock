const {
  loadProjects,
  getProjectById,
  primaryTag,
  projectPath,
  isRemotePath
} = require("./projects")
const { loadPreferences } = require("../config/preferences")
const { getProjectMeta, readPkgJson, resolveOpenLink } = require("./project-meta")
const { getGitInfo } = require("./git")
const { getRepoSessions } = require("../runtime/processes")
const { resolveOpenLinkReady } = require("../runtime/open-link")

const discoverProjects = () => {
  return loadProjects().map((project) => {
    const localPath = projectPath(project)
    const isRemote = isRemotePath(project.rootPath)
    const meta = getProjectMeta(localPath)

    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      path: localPath,
      tags: project.tags,
      primaryTag: primaryTag(project),
      enabled: project.enabled,
      profile: project.profile,
      isRemote,
      isLocal: Boolean(localPath),
      ...meta
    }
  })
}

const getRepoDetails = async (projectId, { skipGit = false } = {}) => {
  const project = getProjectById(projectId)
  if (!project) return null

  const repoPath = projectPath(project)
  const isRemote = isRemotePath(project.rootPath)
  const prefs = loadPreferences()
  const meta = getProjectMeta(repoPath)

  let branch = ""
  let branches = []
  let isDirty = false
  let dirtyCount = 0
  let githubUrl = null
  let hasGit = meta.hasGit

  if (repoPath && !isRemote && meta.hasGit && !skipGit) {
    try {
      const git = await getGitInfo(repoPath)
      branch = git.branch
      branches = git.branches
      isDirty = git.isDirty
      dirtyCount = git.dirtyCount
      githubUrl = git.githubUrl
      hasGit = git.hasGit
    } catch {
      // Git details are optional when the repository or Git is unavailable.
    }
  } else if (repoPath && !isRemote && meta.hasGit && skipGit) {
    githubUrl = null
  }

  const repoSess = getRepoSessions(projectId)

  const openLink = repoPath ? resolveOpenLink(project.name, repoPath) : null
  const { ready: openLinkReady, openLink: resolvedLink } = await resolveOpenLinkReady(
    openLink,
    projectId
  )

  return {
    id: projectId,
    name: project.name,
    rootPath: project.rootPath,
    path: repoPath,
    tags: project.tags,
    primaryTag: primaryTag(project),
    enabled: project.enabled,
    profile: project.profile,
    isRemote,
    isLocal: Boolean(repoPath),
    branch,
    branches,
    isDirty,
    dirtyCount,
    hasGit,
    scripts: meta.scripts,
    packageManager: meta.packageManager,
    hasPackageJson: meta.hasPackageJson,
    isRunning: repoSess.length > 0,
    sessionCount: repoSess.length,
    sessions: repoSess,
    githubUrl,
    scriptOrder: prefs.scriptOrder[projectId] || [],
    openLink: resolvedLink || openLink,
    openLinkReady
  }
}

module.exports = { discoverProjects, getRepoDetails }
