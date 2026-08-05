const fs = require("fs")
const path = require("path")

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const VAR_ACTIVE_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
const VAR_COMMENTED_RE = /^(\s*)#\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

const parseLine = (line) => {
  const commented = line.match(VAR_COMMENTED_RE)
  if (commented) {
    return { type: "varLine", key: commented[2], value: commented[3], active: false }
  }
  const active = line.match(VAR_ACTIVE_RE)
  if (active && !line.trimStart().startsWith("#")) {
    return { type: "varLine", key: active[2], value: active[3], active: true }
  }
  return { type: "raw", text: line }
}

const normalizeVariants = (variants) => {
  if (!variants.length) return [{ value: "", active: true }]
  let activeIdx = variants.findIndex((v) => v.active)
  if (activeIdx < 0) activeIdx = 0
  return variants.map((v, i) => ({
    value: String(v.value ?? ""),
    active: i === activeIdx
  }))
}

const parseEnvContent = (content) => {
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r?\n/)
  const parsed = lines.map(parseLine)

  const keyVariants = new Map()
  for (const item of parsed) {
    if (item.type !== "varLine") continue
    if (!keyVariants.has(item.key)) keyVariants.set(item.key, [])
    keyVariants.get(item.key).push({ value: item.value, active: item.active })
  }

  const entries = []
  const emittedKeys = new Set()

  for (const item of parsed) {
    if (item.type === "raw") {
      entries.push({ type: "raw", text: item.text })
      continue
    }
    if (emittedKeys.has(item.key)) continue
    emittedKeys.add(item.key)
    entries.push({
      type: "var",
      key: item.key,
      variants: normalizeVariants(keyVariants.get(item.key) || [])
    })
  }

  return { eol, entries }
}

const envPathFor = (repoPath) => path.join(repoPath, ".env")

const parseEnvFile = (repoPath) => {
  const envPath = envPathFor(repoPath)
  if (!fs.existsSync(envPath)) {
    return { exists: false, eol: "\n", entries: [] }
  }
  const content = fs.readFileSync(envPath, "utf8")
  const { eol, entries } = parseEnvContent(content)
  return { exists: true, eol, entries }
}

const serializeEntries = (entries, eol) => {
  const parts = []
  for (const entry of entries) {
    if (entry.type === "raw") {
      parts.push(entry.text)
      continue
    }
    if (entry.type !== "var") continue
    const variants = normalizeVariants(entry.variants || [])
    for (const variant of variants) {
      const line = `${entry.key}=${variant.value}`
      parts.push(variant.active ? line : `# ${line}`)
    }
  }
  return parts.join(eol)
}

const writeEnvFile = (repoPath, entries, eol = "\n") => {
  const envPath = envPathFor(repoPath)
  const resolvedEol = fs.existsSync(envPath)
    ? parseEnvContent(fs.readFileSync(envPath, "utf8")).eol
    : eol
  const content = serializeEntries(entries, resolvedEol)
  fs.writeFileSync(envPath, content, "utf8")
  return parseEnvFile(repoPath)
}

const normalizeEntries = (raw) => {
  if (!Array.isArray(raw)) throw new Error("entries required")
  return raw.map((entry) => {
    if (entry?.type === "raw") {
      return { type: "raw", text: String(entry.text ?? "") }
    }
    if (entry?.type === "var") {
      const key = entry.key
      if (!KEY_RE.test(key)) throw new Error(`Invalid key: ${key}`)
      const variants = (entry.variants || []).map((v) => ({
        value: String(v.value ?? ""),
        active: !!v.active
      }))
      if (!variants.length) throw new Error(`No variants for ${key}`)
      return { type: "var", key, variants: normalizeVariants(variants) }
    }
    throw new Error("Invalid entry type")
  })
}

const setActiveVariant = (entries, key, variantIndex) => {
  if (!KEY_RE.test(key)) throw new Error(`Invalid key: ${key}`)
  if (!Number.isInteger(variantIndex) || variantIndex < 0) {
    throw new Error("variantIndex required")
  }
  let found = false
  const next = entries.map((entry) => {
    if (entry.type !== "var" || entry.key !== key) return entry
    if (variantIndex >= entry.variants.length) {
      throw new Error(`Variant index out of range for ${key}`)
    }
    found = true
    return {
      type: "var",
      key,
      variants: entry.variants.map((v, i) => ({
        ...v,
        active: i === variantIndex
      }))
    }
  })
  if (!found) throw new Error(`Key not found: ${key}`)
  return next
}

const serializeEnvExport = (entries, eol = "\n", { includeCommented = false } = {}) => {
  const parts = []
  for (const entry of entries) {
    if (entry.type === "raw") {
      parts.push(entry.text)
      continue
    }
    if (entry.type !== "var") continue
    const variants = normalizeVariants(entry.variants || [])
    if (includeCommented) {
      for (const variant of variants) {
        const line = `${entry.key}=${variant.value}`
        parts.push(variant.active ? line : `# ${line}`)
      }
      continue
    }
    const active = variants.find((v) => v.active) || variants[0]
    if (active) parts.push(`${entry.key}=${active.value}`)
  }
  return parts.join(eol)
}

const serializeActiveEnv = (entries, eol = "\n") => serializeEnvExport(entries, eol)

const writeEnvExample = (repoPath, entries, { includeCommented = false } = {}) => {
  const envPath = envPathFor(repoPath)
  const eol = fs.existsSync(envPath)
    ? parseEnvContent(fs.readFileSync(envPath, "utf8")).eol
    : "\n"
  const content = serializeEnvExport(entries, eol, { includeCommented })
  const examplePath = path.join(repoPath, ".env.example")
  fs.writeFileSync(examplePath, content, "utf8")
  return { path: examplePath, content }
}

const addVariant = (entries, key, value) => {
  if (!KEY_RE.test(key)) throw new Error(`Invalid key: ${key}`)
  const strValue = String(value ?? "")
  let found = false
  const next = entries.map((entry) => {
    if (entry.type !== "var" || entry.key !== key) return entry
    found = true
    return {
      type: "var",
      key,
      variants: [...entry.variants, { value: strValue, active: false }]
    }
  })
  if (!found) {
    next.push({
      type: "var",
      key,
      variants: [{ value: strValue, active: true }]
    })
  }
  return next
}

module.exports = {
  parseEnvFile,
  writeEnvFile,
  normalizeEntries,
  setActiveVariant,
  addVariant,
  serializeActiveEnv,
  serializeEnvExport,
  writeEnvExample
}
