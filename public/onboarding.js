async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const homeInput = document.getElementById("home-path")
const projectsJsonInput = document.getElementById("projects-json-path")
const errorMsg = document.getElementById("error-msg")
const summary = document.getElementById("summary")
const pathStatus = document.getElementById("path-status")

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function showError(msg) {
  errorMsg.hidden = !msg
  errorMsg.textContent = msg || ""
}

function setStep(step) {
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"))
  document.getElementById(`step-${step}`).classList.remove("hidden")
  document.querySelectorAll(".step").forEach((s) => {
    s.classList.toggle("active", Number(s.dataset.step) === step)
  })
  showError("")
}

function joinProjectsJsonPath(home) {
  const trimmed = home.replace(/[\\/]+$/, "")
  const sep = trimmed.includes("\\") ? "\\" : "/"
  return `${trimmed}${sep}projects.json`
}

async function refreshPathStatus() {
  const home = homeInput.value.trim()
  const projectsJson = projectsJsonInput.value.trim() || joinProjectsJsonPath(home)
  if (!home) {
    pathStatus.innerHTML = ""
    return
  }

  try {
    const status = await api("/api/onboarding/check-paths", {
      method: "POST",
      body: JSON.stringify({ homePath: home, projectsJsonPath: projectsJson })
    })

    const parts = []
    if (!status.homeExists) {
      parts.push(
        `<div class="path-status-item warn">${t("onboarding.folderMissing", { path: escapeHtml(status.homePath) })} <button type="button" class="btn btn-sm btn-primary" id="create-home-btn">${escapeHtml(t("onboarding.createFolder"))}</button></div>`
      )
    } else {
      parts.push(
        `<div class="path-status-item ok"><i class="mdi mdi-check-circle-outline"></i> ${escapeHtml(t("onboarding.folderFound"))}</div>`
      )
    }

    if (!status.projectsJsonExists) {
      parts.push(
        `<div class="path-status-item warn">${t("onboarding.jsonMissing", { path: escapeHtml(status.projectsJsonPath) })} <button type="button" class="btn btn-sm btn-primary" id="create-json-btn">${escapeHtml(t("onboarding.createFile"))}</button></div>`
      )
    } else {
      parts.push(
        `<div class="path-status-item ok"><i class="mdi mdi-check-circle-outline"></i> ${escapeHtml(t("onboarding.jsonFound"))}</div>`
      )
    }

    pathStatus.innerHTML = parts.join("")
    document.getElementById("create-home-btn")?.addEventListener("click", () => ensurePaths())
    document.getElementById("create-json-btn")?.addEventListener("click", () => ensurePaths())
  } catch (err) {
    pathStatus.innerHTML = `<div class="path-status-item warn">${escapeHtml(err.message)}</div>`
  }
}

async function ensurePaths() {
  const result = await api("/api/onboarding/ensure-paths", {
    method: "POST",
    body: JSON.stringify({
      homePath: homeInput.value.trim(),
      projectsJsonPath: projectsJsonInput.value.trim()
    })
  })
  if (result.projectsJsonPath) projectsJsonInput.value = result.projectsJsonPath
  await refreshPathStatus()
  return result
}

function renderSummary() {
  summary.innerHTML = `
    <p><strong>${escapeHtml(t("onboarding.summaryHome"))}</strong> ${escapeHtml(homeInput.value.trim())}</p>
    <p><strong>${escapeHtml(t("onboarding.summaryJson"))}</strong> ${escapeHtml(projectsJsonInput.value.trim())}</p>
  `
}

async function init() {
  const status = await api("/api/onboarding/status")

  homeInput.value = status.config?.homePath || status.defaults.homePath
  projectsJsonInput.value = status.config?.projectsJsonPath || status.defaults.projectsJsonPath

  if (status.configured) {
    const subtitle = document.querySelector(".subtitle")
    if (subtitle) subtitle.textContent += t("onboarding.subtitleConfigured")
  }

  await refreshPathStatus()
}

document.getElementById("pick-home").addEventListener("click", async () => {
  try {
    const result = await api("/api/onboarding/pick-folder", { method: "POST", body: "{}" })
    if (!result.cancelled && result.path) {
      homeInput.value = result.path
      projectsJsonInput.value = joinProjectsJsonPath(result.path)
      projectsJsonInput.dataset.manual = ""
      await refreshPathStatus()
    }
  } catch (err) {
    showError(err.message)
  }
})

document.getElementById("pick-projects-json").addEventListener("click", async () => {
  try {
    const result = await api("/api/onboarding/pick-file", {
      method: "POST",
      body: JSON.stringify({ title: t("onboarding.pickProjectsJson") })
    })
    if (!result.cancelled && result.path) {
      projectsJsonInput.value = result.path
      projectsJsonInput.dataset.manual = "1"
      await refreshPathStatus()
    }
  } catch {
    showError(t("onboarding.filePickerWindowsOnly"))
  }
})

homeInput.addEventListener("change", async () => {
  if (!projectsJsonInput.dataset.manual) {
    projectsJsonInput.value = joinProjectsJsonPath(homeInput.value)
  }
  await refreshPathStatus()
})

projectsJsonInput.addEventListener("input", () => {
  projectsJsonInput.dataset.manual = "1"
})

projectsJsonInput.addEventListener("change", () => refreshPathStatus())

document.getElementById("step1-next").addEventListener("click", async () => {
  if (!homeInput.value.trim()) {
    showError(t("onboarding.homeRequired"))
    return
  }
  try {
    await ensurePaths()
    renderSummary()
    setStep(2)
  } catch (err) {
    showError(err.message)
  }
})

document.getElementById("step2-back").addEventListener("click", () => setStep(1))

document.getElementById("step2-finish").addEventListener("click", async () => {
  try {
    await api("/api/onboarding/complete", {
      method: "POST",
      body: JSON.stringify({
        homePath: homeInput.value.trim(),
        projectsJsonPath: projectsJsonInput.value.trim()
      })
    })
    window.location.href = "/"
  } catch (err) {
    showError(err.message)
  }
})

window.onLocaleChange = () => {
  I18n.applyStatic()
  refreshPathStatus().catch(() => {})
  if (!document.getElementById("step-2").classList.contains("hidden")) renderSummary()
}

document.getElementById("lang-toggle")?.addEventListener("click", async () => {
  const next = I18n.locale === "ru" ? "en" : "ru"
  await I18n.setLocale(next)
  api("/api/preferences", {
    method: "PUT",
    body: JSON.stringify({ locale: next })
  }).catch(() => {})
})

async function boot() {
  await I18n.init()
  init().catch((err) => showError(err.message))
}

boot()
