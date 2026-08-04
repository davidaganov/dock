const fs = require("fs")
const path = require("path")

const detectPackageManager = (dir) => {
  if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm"
  if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn"
  return "npm"
}

const readPkgJson = (repoPath) => {
  const pkgPath = path.join(repoPath, "package.json")
  if (!fs.existsSync(pkgPath)) return null
  try {
    return { pkgPath, pkg: JSON.parse(fs.readFileSync(pkgPath, "utf8")) }
  } catch {
    // Invalid package metadata is treated as unavailable.
    return null
  }
}

const readDotEnvValue = (repoPath, key) => {
  const envPath = path.join(repoPath, ".env")
  if (!fs.existsSync(envPath)) return null
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`)
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(re)
    if (!m) continue
    return m[1].trim().replace(/^["']|["']$/g, "") || null
  }
  return null
}

const readNestPort = (repoPath) => {
  for (const rel of ["src/main.ts", "src/main.js"]) {
    const full = path.join(repoPath, rel)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, "utf8")
    const listen = src.match(/\.listen\(\s*(?:process\.env\.(?:PORT|APP_PORT)\s*\|\|\s*)?(\d+)/)
    if (listen) return parseInt(listen[1], 10)
    const envPort = src.match(/process\.env\.(?:PORT|APP_PORT)\s*\|\|\s*(\d+)/)
    if (envPort) return parseInt(envPort[1], 10)
  }
  return null
}

const readConfigPort = (repoPath) => {
  for (const file of ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"]) {
    const full = path.join(repoPath, file)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, "utf8")
    const devServer = src.match(/devServer\s*:\s*\{[^}]*port\s*:\s*(\d+)/s)
    if (devServer) return parseInt(devServer[1], 10)
    const m = src.match(/port\s*:\s*(\d+)/)
    if (m) return parseInt(m[1], 10)
  }
  for (const file of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const full = path.join(repoPath, file)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, "utf8")
    const m = src.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d+)/s)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

const detectOpenKind = (name, repoPath, pkg) => {
  if (/-(front|web|ui)$/i.test(name)) return "app"
  if (/-bff$/i.test(name)) return "swagger"

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  if (deps["@strapi/strapi"] || deps.strapi) return "swagger"
  if (deps["@nestjs/core"] || deps["@nestjs/common"] || deps["@nestjs/swagger"]) return "swagger"

  const hasNuxt =
    deps.nuxt ||
    fs.existsSync(path.join(repoPath, "nuxt.config.ts")) ||
    fs.existsSync(path.join(repoPath, "nuxt.config.js"))
  const hasVite =
    deps.vite ||
    fs.existsSync(path.join(repoPath, "vite.config.ts")) ||
    fs.existsSync(path.join(repoPath, "vite.config.js"))
  if (hasNuxt || hasVite) return "app"

  return null
}

const resolveSwaggerPath = (repoPath, pkg) => {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  if (deps["@strapi/strapi"] || deps.strapi || deps["@strapi/plugin-documentation"]) {
    return "/documentation"
  }

  const swaggerEnv = readDotEnvValue(repoPath, "SWAGGER_PATH")
  const apiPrefix = readDotEnvValue(repoPath, "APP_PREFIX") || "api"
  if (swaggerEnv) {
    const parts = [apiPrefix, swaggerEnv].filter(Boolean).join("/")
    return `/${parts}`.replace(/\/+/g, "/")
  }

  for (const rel of ["src/main.ts", "src/main.js"]) {
    const full = path.join(repoPath, rel)
    if (!fs.existsSync(full)) continue
    const src = fs.readFileSync(full, "utf8")
    const setup = src.match(/SwaggerModule\.setup\(\s*["'`]([^"'`]+)["'`]/)
    if (setup) return `/${setup[1]}`.replace(/\/+/g, "/")
    if (/setupSwagger\s*\(/.test(src)) return "/api"
  }

  return "/api"
}

const resolveDevPort = (repoPath, pkg) => {
  const fromEnv =
    readDotEnvValue(repoPath, "PORT") ||
    readDotEnvValue(repoPath, "NUXT_PORT") ||
    readDotEnvValue(repoPath, "VITE_PORT")
  if (fromEnv && /^\d+$/.test(fromEnv)) return parseInt(fromEnv, 10)

  const fromConfig = readConfigPort(repoPath)
  if (fromConfig) return fromConfig

  const fromNest = readNestPort(repoPath)
  if (fromNest) return fromNest

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const hasNuxt =
    deps.nuxt ||
    fs.existsSync(path.join(repoPath, "nuxt.config.ts")) ||
    fs.existsSync(path.join(repoPath, "nuxt.config.js"))
  if (hasNuxt) return 3000

  if (
    fs.existsSync(path.join(repoPath, "vite.config.ts")) ||
    fs.existsSync(path.join(repoPath, "vite.config.js"))
  ) {
    return 5173
  }

  return null
}

const resolveOpenLink = (name, repoPath) => {
  if (!repoPath || !fs.existsSync(repoPath)) return null

  const parsed = readPkgJson(repoPath)
  const pkg = parsed?.pkg || null
  const kind = detectOpenKind(name, repoPath, pkg)
  if (!kind) return null

  let port = resolveDevPort(repoPath, pkg)
  if (!port) {
    if (kind === "swagger") port = 3000
    else if (kind === "app") port = 5173
    else return null
  }

  if (kind === "app") {
    return { kind: "app", label: "Open", url: `http://localhost:${port}` }
  }

  const swaggerPath = resolveSwaggerPath(repoPath, pkg)
  return {
    kind: "swagger",
    label: "Documentation",
    url: `http://localhost:${port}${swaggerPath}`
  }
}

const pmCommand = (pm, script) => {
  if (pm === "pnpm") return { cmd: "pnpm", args: ["run", script] }
  if (pm === "yarn") return { cmd: "yarn", args: [script] }
  return { cmd: "npm", args: ["run", script] }
}

const pmRunShellLine = (pm, script) => {
  if (pm === "pnpm") return `pnpm run ${script}`
  if (pm === "yarn") return `yarn ${script}`
  return `npm run ${script}`
}

const pmInstallCommand = (pm) => {
  if (pm === "pnpm") return { cmd: "pnpm", args: ["install"] }
  if (pm === "yarn") return { cmd: "yarn", args: ["install"] }
  return { cmd: "npm", args: ["install"] }
}

const getProjectMeta = (localPath) => {
  if (!localPath) {
    return {
      hasPackageJson: false,
      hasGit: false,
      scripts: [],
      packageManager: null
    }
  }

  const parsed = readPkgJson(localPath)
  const hasGit = fs.existsSync(path.join(localPath, ".git"))

  return {
    hasPackageJson: Boolean(parsed),
    hasGit,
    scripts: parsed?.pkg?.scripts ? Object.keys(parsed.pkg.scripts) : [],
    packageManager: parsed ? detectPackageManager(localPath) : null
  }
}

module.exports = {
  detectPackageManager,
  readPkgJson,
  resolveOpenLink,
  pmCommand,
  pmRunShellLine,
  pmInstallCommand,
  getProjectMeta
}
