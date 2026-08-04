const path = require("path")

const PORT = 3848
const HOST = "127.0.0.1"
const HIDDEN_TAG = "__hidden__"
const UNCATEGORIZED_TAG = ""
const UNCATEGORIZED_KEY = "__uncategorized__"

const ROOT_DIR = path.join(__dirname, "..", "..")
const PUBLIC_DIR = path.join(ROOT_DIR, "public")
const DOCK_CONFIG_PATH = path.join(ROOT_DIR, "dock-config.json")
const FAVICON_PATH = path.join(ROOT_DIR, "favicon.ico")

const SKIP_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "project-dashboard",
  "dock",
  "tray",
  "bin",
  "obj"
])

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
}

module.exports = {
  PORT,
  HOST,
  HIDDEN_TAG,
  UNCATEGORIZED_TAG,
  UNCATEGORIZED_KEY,
  ROOT_DIR,
  PUBLIC_DIR,
  DOCK_CONFIG_PATH,
  FAVICON_PATH,
  SKIP_SCAN_DIRS,
  MIME
}
