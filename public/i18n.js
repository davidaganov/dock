const I18n = {
  locale: "en",
  messages: {},

  async init(locale) {
    const stored = localStorage.getItem("locale")
    const initial = locale || stored || "en"
    await this.load(initial)
    document.documentElement.lang = initial
    return initial
  },

  async load(locale) {
    const lang = locale === "en" ? "en" : "ru"
    const res = await fetch(`/locales/${lang}.json`)
    if (!res.ok) throw new Error(`Locale not found: ${lang}`)
    this.messages = await res.json()
    this.locale = lang
    localStorage.setItem("locale", lang)
    document.documentElement.lang = lang
    this.applyStatic()
    this.updateLangButton()
  },

  t(key, params = {}) {
    const parts = String(key).split(".")
    let val = this.messages
    for (const part of parts) {
      val = val?.[part]
    }
    if (typeof val !== "string") return key
    return val.replace(/\{(\w+)\}/g, (_, name) =>
      params[name] !== undefined ? String(params[name]) : `{${name}}`
    )
  },

  applyStatic() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n
      const text = this.t(key)
      if (el.dataset.i18nHtml === "true") el.innerHTML = text
      else el.textContent = text
    })
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = this.t(el.dataset.i18nPlaceholder)
    })
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = this.t(el.dataset.i18nTitle)
    })
    const titleKey = document.body.dataset.pageTitle
    if (titleKey) document.title = this.t(titleKey)
  },

  updateLangButton() {
    const label = document.getElementById("lang-label")
    if (label) label.textContent = this.locale.toUpperCase()
    const btn = document.getElementById("lang-toggle")
    if (btn) btn.title = this.t("header.language")
  },

  async setLocale(locale) {
    const lang = locale === "en" ? "en" : "ru"
    if (lang === this.locale) return
    await this.load(lang)
    if (typeof window.onLocaleChange === "function") window.onLocaleChange()
  },

  toggleLocale() {
    return this.setLocale(this.locale === "ru" ? "en" : "ru")
  }
}

window.I18n = I18n
window.t = (key, params) => I18n.t(key, params)
