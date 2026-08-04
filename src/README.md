# `src/` — server map

Entry: `server.js` → `src/app.js`. Browser UI is in `public/`.

```
src/
├── app.js           HTTP server entry
├── core/            shared constants & primitives
├── config/          dock-config.json read/write
├── projects/        projects.json, tags, discovery
├── runtime/         child processes, SSE, open-link
├── system/          OS dialogs, static files
└── routes/          /api/* handlers
```

## `app.js`

Creates the HTTP server, routes `/api/*`, serves static files, listens on port `3848`, shuts down processes on exit.

## `core/`

| File           | Role                                                      |
| -------------- | --------------------------------------------------------- |
| `constants.js` | Port, host, paths, MIME, scan skip dirs |
| `http.js`      | `sendJson`, `readBody`                                    |
| `paths.js`     | Default home / projects.json paths, path helpers          |

## `config/`

| File             | Role                                                                |
| ---------------- | ------------------------------------------------------------------- |
| `config.js`      | Install keys: `homePath`, `projectsJsonPath`, `onboardingCompleted` |
| `preferences.js` | UI prefs in the same `dock-config.json`                             |

## `projects/`

| File                 | Role                                                       |
| -------------------- | ---------------------------------------------------------- |
| `projects.js`        | CRUD for `projects.json`                                   |
| `projects-watch.js`  | Watch `projects.json` and push SSE reloads                 |
| `tags.js`            | Categories: order, rename, create/delete, numeric prefixes |
| `category-dirs.js`   | Cache of category → folder for create/clone                |
| `scan-tree.js`       | Workspace tree scan                                        |
| `project-meta.js`    | package.json / package manager / Open URL                  |
| `git.js`             | Git helpers                                                |
| `project-service.js` | Assembled list + detail payloads                           |

## `runtime/`

| File           | Role                            |
| -------------- | ------------------------------- |
| `processes.js` | Script/terminal sessions, ports |
| `sse.js`       | Live event broadcast to the UI  |
| `open-link.js` | When Open link/port is ready    |

## `system/`

| File          | Role                                |
| ------------- | ----------------------------------- |
| `explorer.js` | Folder/IDE open, Windows pickers    |
| `static.js`   | `public/*`, favicon, restart helper |

## `routes/`

| File            | Role                                           |
| --------------- | ---------------------------------------------- |
| `onboarding.js` | First-run wizard API                           |
| `settings.js`   | Settings API                                   |
| `api.js`        | Main REST: repos, tags, sessions, create, etc. |
