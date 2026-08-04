const { execFile } = require("child_process")

const runGit = (repoPath, args) => {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message))
      else resolve((stdout || "").trim())
    })
  })
}

const parseGithubUrl = (remote) => {
  if (!remote) return null
  const value = remote.trim()
  let match = value.match(/git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/i)
  if (match) return `https://github.com/${match[1]}`
  match = value.match(/https?:\/\/github\.com\/([^/\s]+?\/[^/\s]+?)(?:\.git)?\/?$/i)
  if (match) return `https://github.com/${match[1]}`
  return null
}

const getGithubUrl = async (repoPath) => {
  const remote = await runGit(repoPath, ["remote", "get-url", "origin"]).catch(() => "")
  return parseGithubUrl(remote)
}

const getGitInfo = async (repoPath) => {
  const [branch, branchesRaw, status, githubUrl] = await Promise.all([
    runGit(repoPath, ["branch", "--show-current"]).catch(() => ""),
    runGit(repoPath, ["branch", "--format=%(refname:short)"]).catch(() => ""),
    runGit(repoPath, ["status", "--porcelain"]).catch(() => ""),
    getGithubUrl(repoPath).catch(() => null)
  ])

  return {
    branch,
    branches: branchesRaw.split("\n").filter(Boolean),
    isDirty: status.length > 0,
    dirtyCount: status.split("\n").filter(Boolean).length,
    githubUrl,
    hasGit: true
  }
}

module.exports = { runGit, getGithubUrl, getGitInfo, parseGithubUrl }
