# ITER-AI Studio

Electron desktop app for building and running AI workflows, with a local HTTP API,
model lab, evaluations, and an in-app IDE agent.

## Requirements

- Node.js 18+ (tested on 26)
- Windows for `.exe` builds (NSIS / portable)

## Develop

```bash
npm install
npm start
```

## Test

```bash
npm test
```

Some tests in `tests/` hit a live provider and read `ANTHROPIC_API_KEY` from
the environment. Copy `.env.example` to `.env` and fill it in first.

## Build a Windows release

```bash
npm run build
```

Output goes to `release/`:

- `ITER-AI Studio Setup <version>.exe` — installer
- `ITER-AI Studio <version>.exe` — portable single exe
- `win-unpacked/` — unpacked app

Optional: add `build/icon.ico` and set `win.icon` in `package.json` for a custom
icon, and set `CSC_LINK` / `CSC_KEY_PASSWORD` to code-sign.

## Releases

Pushing a tag like `v1.0.0` triggers the GitHub Actions build, which attaches the
installer and portable exe to a release. The release body comes from
`RELEASE_NOTES.md` — update that file before tagging.

## Layout
| Path | Purpose |
| --- | --- |
| `main.js` | Electron main process, IPC, local API server bootstrap |
| `preload.js` | Renderer bridge |
| `index.html` + `*.js` | Renderer UI modules |
| `server.js` / `api-handlers.js` | Local HTTP API (`127.0.0.1:3789`) |
| `engine.js` / `workflow.js` | Workflow execution engine |
| `ide-agent.js` | Bounded tool-use agent for the in-app IDE |
| `tests/` | Node test suites and live checks |
