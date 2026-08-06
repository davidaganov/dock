const fs = require("fs")
const path = require("path")
const { detectPackageManager, readPkgJson } = require("../projects/project-meta")

const SECTIONS = ["dependencies", "dev Dependencies"]

const entryKey = (section, name) => `${section}:${name}`

const parseEntryKey = (key) => {
  const idx = key.indexOf(":")
  if (idx < 0) return null
  const section = key.slice(0, idx)
  const name = key.slice(idx + 1)
  if (!SECTIONS.includes(section) || !name) return null
  return { section, name }
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

const readPackageManifest = (repoPath) => {
  const parsed = readPkgJson(repoPath)
  if (!parsed) {
    return { exists: false, packageManager: detectPackageManager(repoPath), entries: [] }
  }
  return {
    exists: true,
    packageManager: detectPackageManager(repoPath),
    pkgPath: parsed.pkgPath,
    pkg: parsed.pkg
  }
}

const buildEntries = (pkg, savedVariants = {}) => {
  if (!pkg) return []
  const entries = []
  for (const section of SECTIONS) {
    const deps = pkg[section]
    if (!deps || typeof deps !== "object") continue
    for (const name of Object.keys(deps).sort()) {
      const key = entryKey(section, name)
      const current = String(deps[name] ?? "")
      const stored = savedVariants[key]
      let variants = stored?.variants?.length
        ? normalizeVariants(stored.variants.map((v) => ({ ...v })))
        : [{ value: current, active: true }]
      const active = variants.find((v) => v.active) || variants[0]
      if (active.value !== current) {
        active.value = current
      }
      const hasCurrent = variants.some((v) => v.value === current)
      if (!hasCurrent) {
        variants = normalizeVariants([
          { value: current, active: true },
          ...variants.map((v) => ({ ...v, active: false }))
        ])
      }
      entries.push({ section, name, key, variants: normalizeVariants(variants) })
    }
  }
  return entries
}

const variantsToPrefs = (entries) => {
  const out = {}
  for (const entry of entries) {
    if (!entry?.key || !entry.variants?.length) continue
    out[entry.key] = { variants: normalizeVariants(entry.variants) }
  }
  return out
}

const writePackageJson = (repoPath, pkg) => {
  const parsed = readPkgJson(repoPath)
  const pkgPath = parsed?.pkgPath || path.join(repoPath, "package.json")
  const content = `${JSON.stringify(pkg, null, 2)}\n`
  fs.writeFileSync(pkgPath, content, "utf8")
}

const applyEntryToPkg = (pkg, entry) => {
  const section = entry.section
  const name = entry.name
  const variants = normalizeVariants(entry.variants || [])
  const active = variants.find((v) => v.active) || variants[0]
  if (!pkg[section] || typeof pkg[section] !== "object") pkg[section] = {}
  pkg[section][name] = active?.value ?? ""
  return pkg
}

const loadPackageState = (repoPath, savedVariants = {}) => {
  const manifest = readPackageManifest(repoPath)
  if (!manifest.exists) return { ...manifest, entries: [] }
  const entries = buildEntries(manifest.pkg, savedVariants)
  return {
    exists: true,
    packageManager: manifest.packageManager,
    entries
  }
}

const savePackageState = (repoPath, entries) => {
  const manifest = readPackageManifest(repoPath)
  if (!manifest.exists) throw new Error("package.json not found")
  const pkg = { ...manifest.pkg }
  for (const section of SECTIONS) {
    if (!pkg[section]) pkg[section] = {}
  }
  for (const entry of entries) {
    if (!entry?.section || !entry?.name) continue
    applyEntryToPkg(pkg, entry)
  }
  writePackageJson(repoPath, pkg)
  return loadPackageState(repoPath, variantsToPrefs(entries))
}

const setActiveVariant = (repoPath, savedVariants, key, variantIndex) => {
  const parsedKey = parseEntryKey(key)
  if (!parsedKey) throw new Error("Invalid package key")
  const manifest = readPackageManifest(repoPath)
  if (!manifest.exists) throw new Error("package.json not found")
  const entries = buildEntries(manifest.pkg, savedVariants)
  const entry = entries.find((item) => item.key === key)
  if (!entry) throw new Error(`Package not found: ${key}`)
  if (
    !Number.isInteger(variantIndex) ||
    variantIndex < 0 ||
    variantIndex >= entry.variants.length
  ) {
    throw new Error("variantIndex out of range")
  }
  entry.variants = entry.variants.map((v, i) => ({ ...v, active: i === variantIndex }))
  const pkg = { ...manifest.pkg }
  applyEntryToPkg(pkg, entry)
  writePackageJson(repoPath, pkg)
  const nextVariants = { ...savedVariants, [key]: { variants: normalizeVariants(entry.variants) } }
  return {
    state: loadPackageState(repoPath, nextVariants),
    packageVariants: nextVariants
  }
}

const addVariant = (repoPath, savedVariants, key, value) => {
  const parsedKey = parseEntryKey(key)
  if (!parsedKey) throw new Error("Invalid package key")
  const manifest = readPackageManifest(repoPath)
  if (!manifest.exists) throw new Error("package.json not found")
  const entries = buildEntries(manifest.pkg, savedVariants)
  const entry = entries.find((item) => item.key === key)
  if (!entry) throw new Error(`Package not found: ${key}`)
  entry.variants = [...entry.variants, { value: String(value ?? ""), active: false }]
  const nextVariants = {
    ...savedVariants,
    [key]: { variants: normalizeVariants(entry.variants) }
  }
  return {
    state: loadPackageState(repoPath, nextVariants),
    packageVariants: nextVariants
  }
}

const updateVariantValue = (repoPath, savedVariants, key, variantIndex, value) => {
  const parsedKey = parseEntryKey(key)
  if (!parsedKey) throw new Error("Invalid package key")
  const manifest = readPackageManifest(repoPath)
  if (!manifest.exists) throw new Error("package.json not found")
  const entries = buildEntries(manifest.pkg, savedVariants)
  const entry = entries.find((item) => item.key === key)
  if (!entry) throw new Error(`Package not found: ${key}`)
  if (
    !Number.isInteger(variantIndex) ||
    variantIndex < 0 ||
    variantIndex >= entry.variants.length
  ) {
    throw new Error("variantIndex out of range")
  }
  entry.variants[variantIndex].value = String(value ?? "")
  let pkg = { ...manifest.pkg }
  const activeIdx = entry.variants.findIndex((v) => v.active)
  if (activeIdx === variantIndex) {
    applyEntryToPkg(pkg, entry)
    writePackageJson(repoPath, pkg)
  }
  const nextVariants = {
    ...savedVariants,
    [key]: { variants: normalizeVariants(entry.variants) }
  }
  return {
    state: loadPackageState(repoPath, nextVariants),
    packageVariants: nextVariants,
    wrotePackageJson: activeIdx === variantIndex
  }
}

const normalizePackageEntries = (raw) => {
  if (!Array.isArray(raw)) throw new Error("entries required")
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid entry")
    const section = entry.section
    const name = entry.name
    if (!SECTIONS.includes(section) || typeof name !== "string" || !name.trim()) {
      throw new Error("Invalid package entry")
    }
    const variants = (entry.variants || []).map((v) => ({
      value: String(v.value ?? ""),
      active: !!v.active
    }))
    if (!variants.length) throw new Error(`No variants for ${name}`)
    const key = entryKey(section, name.trim())
    return {
      section,
      name: name.trim(),
      key,
      variants: normalizeVariants(variants)
    }
  })
}

module.exports = {
  entryKey,
  parseEntryKey,
  readPackageManifest,
  loadPackageState,
  savePackageState,
  setActiveVariant,
  addVariant,
  updateVariantValue,
  normalizePackageEntries,
  variantsToPrefs
}
