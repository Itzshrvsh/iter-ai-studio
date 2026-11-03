# Current State — ITER-AI Studio (pre-shell audit)

Date: 2026-11-02

## Stack
- Electron 38 (vanilla JS, no framework, no bundler)
- Entry: `main.js` -> loads `index.html`
- Renderer logic: `renderer.js` (plain DOM manipulation)
- Persistence: `localStorage` only
- Tests: none
- Build/run: `npm start`

## Feature inventory
| Feature | Status | Source |
|---|---|---|
| OpenAI-compatible chat (non-streaming) | Implemented | `renderer.js` |
| Provider settings (base URL, key, model) | Implemented (plaintext localStorage) | `renderer.js` |
| Editable system prompt | Implemented | `index.html`, `renderer.js` |
| Streaming, cancellation, retries | Missing | — |
| Run events / Run Inspector | Missing | — |
| Workflow editor | Missing | — |
| Profiles, projects, memory, evals | Missing | — |

## Known constraints / risks
- `nodeIntegration: true, contextIsolation: false` — acceptable for local tool, noted for later hardening.
- API key stored plaintext in localStorage (acceptable for local-first v1; must never be logged/exported).
- Electron install script blocked by npm allowScripts policy; binary + `path.txt` fixed manually. Documented workaround required on reinstall.

## Baseline task suite (repeatable)
1. Configure LM Studio/Ollama/OpenAI endpoint.
2. Send single message, receive reply.
3. Set system prompt, confirm reply tone follows it.
4. Change model field, resend.
5. Clear conversation.
6. Reload app, confirm settings persist.
7. Verify error surface for bad key/bad URL shows readable message.

## Decision record (ADR-001): remain vanilla ES modules (no React/Vite/Flow yet)
The plan suggests React+TS+React Flow, but repo has zero legacy forcing a rewrite
and Phase 1 only requires a shell. Vanilla keeps the audit footprint small;
the shell will be structured with a hash router + page modules so a framework
migration (Phase 3+ graph editor likely needing React Flow) remains cheap.
Revisit at Phase 3.

## Added section: Agentic Coding

A new `Agentic Coding` page (`agentic.js`, nav after `IDE Agent`) stores reusable
coding-agent presets in `iterai.agentPresets` and runs them with the same bounded
tool loop as the IDE page (`ide-agent.js`). Each preset defines a name, standing
instructions, default task, workspace, model, max steps, approval gate, and the
allowed subset of tools (`list_dir`, `read_file`, `write_file`, `run_command`).
Runs are recorded in `iterai.agentRuns` (last 20) and shown as a recent-run list
on the page. Five starter presets ship with the page: feature implementer,
bug fixer, test writer, safe refactorer, and read-only reviewer.

Tests: `tests/agentic-check.js` (UI/preset persistence) and
`tests/agentic-run-check.js` (end-to-end run against a mock provider).

