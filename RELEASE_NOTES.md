## ITER-AI Studio v1.0.0

First public release of ITER-AI Studio — a desktop app for building, running, and evaluating AI workflows, with a local HTTP API and an in-app coding agent.

### Highlights

- **Workflow engine** — compose multi-step agent workflows, run them locally, and inspect per-step runs.
- **Model Lab** — add providers (OpenAI-compatible), test connections, and compare models.
- **Local HTTP API** — `127.0.0.1:3789`, token-authenticated, for scripting and integrations.
- **IDE agent** — bounded tool-use loop (`list_dir`, `read_file`, `write_file`, `run_command`) over a chosen project folder.
- **Evaluations & memory** — suite-based evals, behavior profiles, and per-project memory.
- **Desktop-native** — folder picker, persisted state, single-exe launch.

### Downloads

| Asset | Use |
| --- | --- |
| `ITER-AI Studio Setup 1.0.0.exe` | Installer (choose install dir, desktop + start-menu shortcuts) |
| `ITER-AI Studio 1.0.0.exe` | Portable — no install required |

Built for **Windows x64**.

### Getting started

1. Run the installer or the portable exe.
2. Open **Providers** and add an OpenAI-compatible endpoint (base URL, model, API key).
3. Create a workflow or try a template, then run it.

### Notes

- Builds are **not code-signed**, so Windows SmartScreen may show a warning → *More info → Run anyway*.
- Uses the default Electron icon in this release.
- State is stored per-user; uninstalling does not remove saved data.
