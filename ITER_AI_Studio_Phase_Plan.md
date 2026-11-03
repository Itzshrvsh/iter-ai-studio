# ITER-AI Studio --- Phased Product & Implementation Plan

**Document type:** Product specification and phased engineering plan\
**Product:** ITER-AI Studio\
**Goal:** Help small local language models (especially models around 9B
parameters or smaller) complete useful work more reliably through
controllable workflows, bounded steps, selective context, tool
execution, verification, and evidence-based adaptation.

------------------------------------------------------------------------

## 1. Product Vision

ITER-AI Studio is a local-first AI workbench, not merely a chat UI.
Users describe an outcome, select a local model, define how the model
should work, inspect and edit the generated workflow, then execute it
with visible controls and verifiable results.

The core product loop is:

1.  Capture the user's goal, constraints, and definition of done.
2.  Propose a structured workflow.
3.  Let the user inspect and edit every step before execution.
4.  Execute bounded steps with explicit inputs, outputs, permissions,
    and limits.
5.  Validate outputs using tests, schemas, assertions, or other
    evidence.
6.  Diagnose failures and propose targeted workflow changes.
7.  Require approval for sensitive changes or actions.
8.  Save the run, evidence, workflow version, token usage, and outcome.
9.  Compare workflow versions against the same task set to measure
    whether changes actually help.

**Product principle:** The model may propose changes to its workflow,
but the orchestration engine validates and applies them. The model must
not silently rewrite its own permissions, safety limits, or execution
policies.

## 2. Product Design Principles

-   **Local-first:** Support LM Studio, Ollama, llama.cpp servers, and
    other OpenAI-compatible endpoints.
-   **Control before autonomy:** Every automatic behavior has a visible
    setting, scope, and limit.
-   **Small steps:** Prefer focused tasks with explicit contracts over
    huge prompts that ask a small model to do everything at once.
-   **Evidence over confidence:** A model saying "done" is not proof.
    Use tests, file diffs, command output, and explicit acceptance
    checks.
-   **Editable automation:** Users can edit prompts, node settings,
    edges, conditions, retry rules, routing, and context policies.
-   **Token transparency:** Report input, output, reasoning tokens when
    exposed by the provider, cached tokens when exposed, tool calls,
    latency, and estimated cost. Never invent unavailable metrics.
-   **Reproducibility:** Save workflow versions, settings, model IDs,
    run events, and artifacts.
-   **Safe execution:** Use workspace scoping, command allowlists,
    approval gates, backups, and rollback.
-   **Graceful failure:** A failed step should explain what failed,
    preserve evidence, and offer a bounded recovery plan.
-   **Provider honesty:** Distinguish model-reported metrics,
    provider-reported metrics, and estimates.

------------------------------------------------------------------------

# Phase 0 --- Repository Audit and Product Foundation

**Objective:** Understand and preserve existing working code before
changing architecture or UI.

### Work items

-   Inspect the existing repository, framework, entry points, dependency
    files, tests, and current execution loop.
-   Map existing components such as Planner, Executor, Observer, Critic,
    Judge, Strategist, memory, and tool adapters.
-   Identify which features are implemented, partially implemented,
    mocked, or missing.
-   Record current API contracts and model-provider assumptions.
-   Create an architecture decision record before replacing major
    components.
-   Establish a baseline task suite for current behavior.

### Deliverables

-   `docs/architecture/current-state.md`
-   `docs/architecture/target-state.md`
-   A current-feature inventory with status and source-file references.
-   A baseline set of 5--10 repeatable tasks.
-   A list of known defects and compatibility risks.

### Acceptance criteria

-   No working subsystem is rewritten merely to fit the new design.
-   The app can still start using the existing documented process.
-   Existing tests are recorded and run before major changes.
-   Unknowns are documented rather than guessed.

------------------------------------------------------------------------

# Phase 1 --- Visual Foundation and Application Shell

**Objective:** Build the polished, responsive application shell and
navigation without pretending backend features already work.

## Visual direction

Create a premium, technical desktop UI inspired by professional IDEs and
observability tools, not a generic chatbot template.

-   Dark graphite background: near-black base with slightly lighter
    surfaces.
-   Restrained violet accent for AI/workflow actions, cyan for live
    telemetry, green for verified success, amber for warnings, red for
    errors.
-   Thin borders, subtle depth, compact typography, clear hierarchy,
    consistent spacing.
-   Avoid excessive neon glow, oversized cards, decorative gradients,
    and meaningless animated charts.
-   Use animation only for meaningful state changes: running nodes,
    streaming output, expanding panels, and navigation.
-   Support light mode later through design tokens rather than hardcoded
    colors.

## Main layout

### A. Global left sidebar

Resizable and collapsible, with icon-only collapsed mode.

Navigation: - Command Center - Chat - Flow Architect - Model Lab - Run
Inspector - Evaluations - Projects & Memory - Settings

Sidebar details: - Project switcher at top. - Recent projects and pinned
workflows. - Run status indicator while a task is active. - New task /
new workflow shortcuts. - Connection indicator for the currently
selected local model server. - Keyboard shortcut hints in tooltips. -
User-configurable navigation order in a later phase.

### B. Top bar

-   Current project and workspace path.
-   Active workflow and version.
-   Selected model and connection status.
-   Token/context usage indicator.
-   Save state.
-   Run, pause, resume, stop, and approval-required indicators.
-   Global search and command palette.
-   Unsaved changes warning before navigation or execution.

### C. Content area

-   Page-specific content with consistent spacing and panel behavior.
-   Resizable panes where relevant.
-   Empty states that explain the next action.
-   Loading, error, disconnected, and permission-denied states.
-   Responsive layout for smaller screens, with a practical minimum
    desktop width.

### D. Bottom activity area

Optional, collapsible dock with: - Events - Logs - Tool output -
Problems - Token usage - Changed files - Approvals

### Deliverables

-   Application shell and routing.
-   Design tokens and reusable component library.
-   Sidebar, top bar, command palette, toasts, dialogs, tooltips, split
    panes, tables, tabs, badges, and empty states.
-   Mock data only where clearly labeled as demo data.

### Acceptance criteria

-   Every navigation item opens a real page, even if a feature is marked
    "not implemented."
-   Layout remains usable at common desktop sizes.
-   Keyboard focus and visible focus states work.
-   No button is decorative: either it performs an action or is visibly
    disabled with an explanation.
-   UI never displays fabricated execution metrics as real data.

------------------------------------------------------------------------

# Phase 2 --- Chat Workspace and Local Model Gateway

**Objective:** Provide a dependable chat interface connected to actual
local or remote OpenAI-compatible model endpoints.

## Chat page layout

Three optional panels:

1.  **Conversation sidebar:** New chat, search, pinned conversations,
    history, project association.
2.  **Chat transcript:** Streaming messages, code blocks, diffs, tool
    events, attachments, copy/retry/edit/resend actions.
3.  **Context inspector:** Included files, retrieved memory, active
    system prompt, token estimates, model parameters, and request
    metadata.

The context inspector must be collapsible. Do not permanently consume
valuable screen space.

## Composer controls

-   Multiline prompt editor.
-   Attach file / add workspace file.
-   Mention files or project context.
-   Model selector.
-   System prompt/profile selector.
-   Temperature and other supported generation settings.
-   Maximum output tokens.
-   Context budget.
-   Stop generation.
-   Send and regenerate.
-   Optional "answer only" versus "agent task" mode.
-   Visible warning when a provider ignores a requested parameter.

## Provider configuration

Each provider profile stores: - Display name. - Base URL. -
Authentication reference (secret stored outside ordinary project
JSON). - API compatibility mode. - Model IDs and display names. -
Context/output limits, marked as provider-reported or user-configured. -
Supported parameters. - Connection timeout and retry policy. -
Health-check result and last successful connection. - Whether the
endpoint is local, remote, or unknown.

Support LM Studio, Ollama, llama.cpp, and custom OpenAI-compatible
endpoints. Do not assume every provider implements the same features.

## Token and context controls

-   Show estimated prompt tokens before sending when a tokenizer is
    available.
-   Show provider-reported input/output usage after a response when
    available.
-   Clearly mark estimates versus authoritative counts.
-   Configure warning thresholds for context utilization.
-   Configure a maximum context budget per request.
-   Allow users to exclude old messages, tool logs, or irrelevant files
    from context.
-   Summarize conversation history only when enabled, with the summary
    visible and editable.
-   Never silently discard critical requirements from context.
-   Provide "inspect exact request" for debugging, with secrets
    redacted.

### Acceptance criteria

-   Chat works end-to-end against a real configured endpoint.
-   Streaming, cancellation, errors, timeout, and reconnect behavior are
    handled.
-   Provider/model IDs are not guessed.
-   Token metrics clearly distinguish unavailable, estimated, and
    provider-reported values.
-   Secrets are never displayed in logs or exported workflow files.

------------------------------------------------------------------------

# Phase 3 --- Flow Architect: Visual Workflow Builder

**Objective:** Let users design how a model works, rather than only
changing one large system prompt.

## Canvas layout

-   **Left node palette:** Planning, LLM call, tool call, code
    generation, file read, command, test, condition, loop, approval,
    memory retrieval, summarization, critic, judge, and output.
-   **Center canvas:** Pan/zoom node graph with connected ports and
    dependency edges.
-   **Right inspector:** Settings for the selected node or edge.
-   **Bottom panel:** Validation errors, execution preview, and node
    output preview.
-   **Top canvas toolbar:** Undo, redo, auto-layout, zoom, fit,
    validate, save version, compare versions, run test, and publish
    workflow.

## Node interactions

-   Drag nodes from the palette.
-   Connect typed input/output ports.
-   Duplicate, disable, rename, group, and delete nodes.
-   Add notes and color labels.
-   Select multiple nodes and edit shared settings.
-   Search nodes by name.
-   Pin nodes or groups.
-   Show dependencies and downstream impact.
-   Prevent invalid connections with clear explanations.
-   Undo and redo graph edits.
-   Save drafts separately from published versions.

## Node configuration

Every node should expose only relevant settings, with an Advanced
section for less common options.

### Common settings

-   Name and description.
-   Enabled/disabled.
-   Input mapping.
-   Output schema.
-   Prompt template.
-   Model/provider override.
-   Timeout.
-   Retry limit and retry delay.
-   Failure behavior: stop, retry, skip, branch, or request approval.
-   Maximum output tokens.
-   Context inclusion policy.
-   Validation rules.
-   Permissions required.
-   Tags and notes.

### Edge configuration

-   Condition or expression.
-   Success/failure routing.
-   Data mapping.
-   Whether a branch is optional.
-   Loop/back-edge policy with an explicit maximum iteration count.
-   Human approval requirement before crossing a boundary.

## Workflow templates

Ship editable templates: - Research and summarize. - Build a small code
feature. - Debug a failing test. - Refactor a module. - Analyze a
dataset. - Operate a desktop workflow. - Review and verify generated
output.

Templates are starting points, not magic behavior. Every node and prompt
must be inspectable.

### Acceptance criteria

-   Workflow is stored as validated structured data, not only as a
    visual canvas state.
-   Graph changes persist across reloads.
-   Invalid graphs show actionable errors before execution.
-   A workflow can be duplicated and versioned.
-   Node settings can be edited without manually editing JSON.
-   The graph supports deterministic execution order and explicit branch
    semantics.

------------------------------------------------------------------------

# Phase 4 --- Model Driving: Behavior and Policy Studio

**Objective:** Give users fine-grained control over how the model
interprets goals, plans, uses tools, responds to failures, and proposes
workflow changes.

This is the product's key differentiator.

## Page structure

Use tabs within Model Driving:

1.  Behavior
2.  Planning
3.  Context
4.  Tool Use
5.  Verification
6.  Recovery
7.  Adaptation
8.  Budget & Limits
9.  Safety & Permissions
10. Preview & Test

Use a left-side profile list and a main editor. Each profile can be
applied globally, per project, per workflow, or to an individual node.
Show inheritance and overrides explicitly.

## A. Behavior

Controls: - System prompt editor with version history. - Role and
objective. - Tone and response format. - Conciseness level. -
Ask-versus-assume policy. - Requirement-preservation policy. -
Structured output requirement. - "Explain decisions" mode versus concise
operational mode. - Rules the model must never change. - Reusable prompt
snippets. - Prompt variables with validation and preview.

Prompt editing features: - Syntax highlighting for variables. -
Character/token estimate. - Insert template variable. - Compare
versions. - Reset to inherited prompt. - Test prompt against a saved
example. - Show the final assembled prompt with secrets redacted.

## B. Planning

Controls: - Planning strategy: direct, staged, hierarchical, or
user-defined workflow. - Maximum planning depth. - Maximum tasks per
plan. - Maximum subtasks per task. - Minimum task size / decomposition
threshold. - Required fields for each task: objective, inputs, expected
output, acceptance criteria, dependencies, risk, and estimated effort. -
Require a plan review before execution. - Allow plan revision after
failure. - Allow only local step edits or full plan regeneration. -
Require approval for changing scope. - Freeze approved steps. - Permit
reordering only when dependencies remain valid.

## C. Context management

Controls: - Maximum prompt/context budget. - Reserve tokens for model
output. - Include/exclude conversation history. - Include project
summary. - File retrieval strategy: manual selection, keyword search,
semantic retrieval, or hybrid. - Maximum files per step. - Maximum
excerpt size per file. - Maximum tool-output size. - Summarize long
outputs. - Keep recent errors and acceptance criteria pinned. -
Deduplicate repeated context. - Context compression threshold. - Memory
retrieval threshold. - Show exactly what context was included in each
model call.

Context priority order should be configurable. A safe default is:
current task and acceptance criteria, explicit user constraints,
relevant source excerpts, recent error evidence, project summary, then
optional conversation history.

Do not silently truncate critical constraints. If the request cannot
fit, show the conflict and propose a resolution.

## D. Tool use

Controls: - Tool allowlist per workflow and node. - Read-only versus
write-capable filesystem access. - Workspace root and excluded paths. -
Shell command allowlist/denylist. - Network access: disabled,
allowlisted, or unrestricted with warning. - Browser/desktop access if
available. - Maximum tool calls per task. - Maximum tool calls per
node. - Tool timeout. - Maximum returned output size. - Approval before
writes, deletes, installs, network requests, or commands outside the
allowlist. - Require diff preview before applying code changes. -
Require backups for destructive operations. - Tool failure policy. -
Tool output schema and validation.

Permissions must be enforced by the backend. Hiding a button in the UI
is not a security boundary.

## E. Verification

Controls: - Required checks per task type. - Run unit tests, lint, type
checks, build, schema validation, or custom commands. - Acceptance
criteria editor. - Evidence requirement: command output, test result,
diff, artifact, or human confirmation. - Number of verification
attempts. - Independent critic model, same model, deterministic checker,
or combination. - Pass threshold for structured evaluations. - Require
explicit proof for claims such as "tests pass." - On verification
failure: targeted repair, re-plan, request approval, or stop.

A language model's confidence alone must never mark a task as verified.

## F. Recovery

Controls: - Retry failed request. - Retry with smaller context. -
Retrieve relevant error and source excerpts. - Ask the model for a
minimal patch. - Roll back the last change. - Re-run only the failed
node. - Re-run downstream dependent nodes. - Regenerate the whole plan
only when explicitly permitted. - Maximum recovery attempts. - Stop
after repeated identical errors. - Detect loops by repeated tool calls,
unchanged state, repeated errors, or no progress. - Recovery timeout and
token budget.

## G. Adaptation / workflow self-modification

Modes: - **Manual:** Never change workflow automatically. - **Suggest:**
Propose changes and wait for approval. - **Bounded auto-adapt:** Apply
changes inside user-defined limits. - **Experiment:** Create a candidate
workflow version and evaluate it on a test set without replacing the
stable version. - **Frozen:** Workflow and prompts cannot be changed
during execution.

Controls: - Which nodes can be inserted, removed, reordered, or
reconfigured. - Whether prompts can be changed. - Whether models can be
switched. - Whether retry rules can change. - Maximum graph edits per
run. - Maximum number of new nodes. - Maximum workflow versions created
per task. - Allowed node types. - Protected nodes and protected
settings. - Required validation after a graph change. - Require approval
for permission changes, new tools, network access, destructive actions,
or scope changes. - Candidate evaluation criteria. - Rollback
threshold. - Compare candidate against stable version before promotion.

The model may propose a JSON patch to a workflow. The backend validates
the patch against a schema and policy, then records the change. It
cannot change its own maximum budget, protected safety rules, or
approval requirements.

## H. Budget & limits

Controls: - Maximum input tokens per model call. - Maximum output tokens
per model call. - Maximum cumulative input/output tokens per task. -
Maximum estimated cost when provider pricing is known. - Maximum
wall-clock time. - Maximum model calls. - Maximum tool calls. - Maximum
parallel tasks. - Maximum retries and loop iterations. - Stop, pause, or
ask for approval when limits are reached. - Warning thresholds at
configurable percentages. - Budget allocation by workflow node. -
Optional reserve for verification and recovery.

Token budgets must be enforced even when the model fails to finish. If
provider usage is unavailable, use conservative estimates and label
them.

## I. Safety & permissions

-   Workspace sandbox.
-   Read/write/delete permissions.
-   Command approval policy.
-   Network policy.
-   Secret redaction.
-   Protected files and directories.
-   Git diff and rollback support.
-   Approval gates for high-impact actions.
-   Audit log.
-   Emergency stop.
-   Cancel active run and terminate subprocesses where possible.
-   Separate model instructions from backend-enforced policies.

## J. Preview & Test

-   Assemble the effective prompt.
-   Show effective settings and their source: global, project, workflow,
    or node override.
-   Test on saved inputs.
-   Compare two prompt/profile versions.
-   Run a dry run with tools disabled.
-   Inspect proposed workflow changes.
-   Estimate context and token budget.
-   Show schema validation errors before saving.
-   Save test fixtures and expected outputs.

### Acceptance criteria

-   Every behavior setting has a defined backend effect, or is clearly
    marked as UI-only/not implemented.
-   Effective settings are visible before execution.
-   Profile inheritance and overrides are understandable.
-   Automatic adaptation respects hard limits and protected settings.
-   Workflow changes are versioned and reversible.
-   All model-driven modifications are validated before they are
    applied.

------------------------------------------------------------------------

# Phase 5 --- Execution Engine and Run Inspector

**Objective:** Execute workflows reliably and expose every meaningful
event to the UI.

## Execution lifecycle

Suggested states: - Draft - Validating - Ready - Running - Waiting for
approval - Paused - Recovering - Completed - Failed - Cancelled - Limit
reached

Each transition should be explicit and persisted.

## Run Inspector layout

### Header

-   Run ID, workflow version, project, model profile, start time,
    elapsed time.
-   Current state.
-   Pause, resume, cancel, retry, and export controls according to
    permissions.

### Left timeline

-   Node sequence and branch paths.
-   Status per node.
-   Duration, attempt number, and token usage when available.
-   Clear indicators for skipped, blocked, retried, and failed nodes.

### Main detail panel

Tabs: - Summary - Prompt/context - Model response - Tool calls -
Files/diffs - Verification - Errors - Adaptation proposals - Metrics

### Right inspector

-   Node configuration at execution time.
-   Effective model settings.
-   Input/output schema.
-   Dependencies.
-   Retry and recovery history.

## Run event schema

Persist structured events such as: - `run.created` - `run.started` -
`node.started` - `model.requested` - `model.completed` -
`tool.requested` - `tool.completed` - `validation.failed` -
`recovery.proposed` - `workflow.change.proposed` -
`workflow.change.applied` - `approval.requested` - `approval.resolved` -
`node.completed` - `run.completed` - `run.failed` - `run.cancelled` -
`budget.threshold` - `budget.exceeded`

Each event should include timestamp, run ID, node ID when applicable,
attempt, status, duration, and relevant redacted metadata.

### Acceptance criteria

-   Events stream to the frontend without requiring page refresh.
-   Refreshing the browser restores the persisted run state.
-   Cancellation and pause are not falsely reported as successful before
    the backend confirms the state.
-   Failed runs retain diagnostic information.
-   Secrets and sensitive file contents are redacted in exported logs.

------------------------------------------------------------------------

# Phase 6 --- Projects, Memory, and Context Efficiency

**Objective:** Reduce repeated context without losing important
requirements.

## Project workspace

-   Project name and root directory.
-   Project instructions.
-   Technology stack and conventions.
-   Key files and entry points.
-   Test/build commands.
-   Known constraints and decisions.
-   Protected files.
-   Project-specific model profile and workflows.

## Memory categories

Separate: - Stable project facts. - User-approved decisions. - Verified
technical findings. - Known failures and fixes. - Workflow performance
summaries. - Temporary task state.

Each memory entry should record source, timestamp,
confidence/provenance, scope, and whether it was verified or
user-approved.

## Context retrieval

-   Keyword and path search first where suitable.
-   Optional embeddings/semantic search.
-   Hybrid ranking.
-   Relevant excerpts rather than entire files.
-   Deduplication.
-   Context preview.
-   User pinning of critical constraints.
-   Expiration or invalidation when source files change.
-   Explicit "forget this project fact" and edit controls.

Do not treat model-generated memory as verified fact without provenance
or validation.

### Acceptance criteria

-   The run inspector can show which memory entries and files influenced
    a model request.
-   Context can be reduced without dropping pinned requirements.
-   A project can be exported without exposing API keys or other
    secrets.
-   Users can edit or remove stored project memory.

------------------------------------------------------------------------

# Phase 7 --- Model Lab, Routing, and Local Inference

**Objective:** Make local models interchangeable and route tasks based
on capability and cost.

## Model inventory

For each configured model, display: - Provider and exact model ID. -
Endpoint and connection health. - Context and output limits. - Supported
tool-calling behavior if tested. - Structured-output support if
tested. - Vision support if tested. - Observed latency and tokens per
second. - Input/output usage where available. - Test-suite results. -
User notes and preferred roles.

Do not infer capabilities solely from a model name. Probe and test where
practical.

## Role-based routing

Roles may include: - Planner. - Coder. - Summarizer. - Critic. -
Judge. - Vision/observer. - Fast classifier.

Routing policy options: - Fixed model. - Manual per-node selection. -
Rule-based routing. - Benchmark-based routing. - Fallback model on
failure.

A fallback model must be explicitly configured. Do not silently send
local data to a remote provider.

## Small-model efficiency strategies

-   Short, role-specific prompts.
-   Constrained JSON outputs for structured tasks.
-   One bounded task per call.
-   Retrieval of relevant source excerpts.
-   Reuse validated intermediate artifacts.
-   Deterministic checks for simple conditions.
-   Summarize large tool outputs.
-   Stop repeated identical failures.
-   Reserve budget for verification.
-   Use stronger models only for tasks where measured benefit justifies
    the cost.

### Acceptance criteria

-   Switching models does not corrupt workflow state.
-   Routing decisions are visible in the run timeline.
-   Local-only mode never falls back to a remote model without explicit
    permission.
-   Benchmark results are reproducible and show task success, tokens,
    latency, and failure rate.

------------------------------------------------------------------------

# Phase 8 --- Evaluations and Workflow Evolution

**Objective:** Measure whether a workflow revision improves real task
outcomes rather than merely producing more convincing explanations.

## Evaluation suite

-   User-defined task fixtures.
-   Input context and workspace snapshot.
-   Expected outcomes and acceptance criteria.
-   Deterministic tests where possible.
-   Optional human rating for subjective outputs.
-   Repeat runs to account for model variability.
-   Baseline workflow and candidate workflow comparison.

## Metrics

-   Task completion rate.
-   Acceptance-test pass rate.
-   Input and output tokens.
-   Total tokens per successful task.
-   Model-call count.
-   Tool-call count.
-   Retry count.
-   Wall-clock duration.
-   Estimated cost when available.
-   Regression rate.
-   Human intervention count.

**Primary metric:** total tokens per successfully verified task,
considered alongside correctness and time. Minimizing tokens while
producing incorrect output is not an optimization.

## Candidate promotion

1.  Snapshot the stable workflow.
2.  Generate a proposed change.
3.  Validate the graph and policies.
4.  Run candidate against saved evaluation cases.
5.  Compare results against baseline.
6.  Show trade-offs and regressions.
7.  Ask for approval or apply a configured promotion rule.
8.  Keep rollback available.

### Acceptance criteria

-   A candidate cannot overwrite the stable workflow before evaluation
    when experiment mode is enabled.
-   Comparisons use the same fixtures and comparable limits.
-   Regressions are visible.
-   Results distinguish verified metrics from model-judged metrics.
-   The system can restore a previous workflow version.

------------------------------------------------------------------------

# Phase 9 --- Advanced UX, Extensibility, and Reliability

**Objective:** Make the application comfortable for sustained daily use.

Potential capabilities: - Plugin/tool adapter system. - Import/export
workflow files. - Workflow sharing with secret redaction. - Reusable
subflows. - Multi-project search. - Keyboard-driven operation. - Custom
themes and density settings. - Accessibility review. - Backup and
restore. - Crash recovery. - Database migrations. - Structured
diagnostics and support bundle export. - Optional remote-provider
support with explicit privacy warnings. - Optional team collaboration
only after single-user reliability is strong.

### Acceptance criteria

-   Upgrades preserve user workflows and run history.
-   Export/import validates schemas and handles missing providers.
-   Plugin permissions are explicit.
-   App failures produce actionable diagnostics without leaking secrets.

------------------------------------------------------------------------

# 10. Recommended Technical Architecture

Adapt this to the repository audit; do not impose a new framework if a
working equivalent already exists.

## Frontend

-   React + TypeScript.
-   Vite.
-   Tailwind CSS with design tokens.
-   React Flow or an equivalent graph editor for the visual workflow
    canvas.
-   A typed API client.
-   WebSocket or Server-Sent Events for run events.
-   Accessible component primitives.

## Backend

-   Existing FastAPI application, if present.
-   Typed request/response schemas.
-   Provider adapter interface for OpenAI-compatible APIs.
-   Workflow schema and validator.
-   Deterministic orchestration engine.
-   Tool adapters with permission enforcement.
-   Event streaming.
-   Run manager with pause/cancel semantics.
-   SQLite for local persistence; migrations from the beginning.
-   Optional vector search only when justified by measured retrieval
    needs.

## Suggested domain entities

-   `Project`
-   `ProviderProfile`
-   `ModelProfile`
-   `BehaviorProfile`
-   `Workflow`
-   `WorkflowVersion`
-   `WorkflowNode`
-   `WorkflowEdge`
-   `Run`
-   `RunEvent`
-   `NodeAttempt`
-   `ApprovalRequest`
-   `Artifact`
-   `MemoryEntry`
-   `EvaluationSuite`
-   `EvaluationCase`
-   `EvaluationResult`

## API areas

-   `/api/projects`
-   `/api/providers`
-   `/api/models`
-   `/api/profiles`
-   `/api/workflows`
-   `/api/workflows/{id}/versions`
-   `/api/workflows/{id}/validate`
-   `/api/runs`
-   `/api/runs/{id}`
-   `/api/runs/{id}/events`
-   `/api/runs/{id}/pause`
-   `/api/runs/{id}/resume`
-   `/api/runs/{id}/cancel`
-   `/api/approvals`
-   `/api/memory`
-   `/api/evaluations`

Define exact schemas after inspecting the existing API. Avoid duplicate
endpoints for functionality already present.

------------------------------------------------------------------------

# 11. Global UX and Control Requirements

Every long-running operation should expose: - Current state. - Progress
with a meaningful definition. - Stop/cancel control where technically
possible. - Relevant limits. - Recent event and error. - Whether a human
action is required.

Every editable configuration should expose: - Current value. - Inherited
source. - Validation. - Save/apply behavior. - Reset behavior. - Version
history for important prompts and workflows.

Every destructive or high-impact action should expose: - What will
change. - Scope. - Preview or diff where possible. - Required
approval. - Recovery or rollback path when possible.

Every metric should expose: - Value. - Unit. - Source. - Whether it is
exact or estimated. - Time window.

Avoid fake progress bars. If the engine cannot estimate completion, show
the current phase and latest event instead of an invented percentage.

------------------------------------------------------------------------

# 12. Suggested Delivery Order

1.  **Phase 0:** Audit the current repository and preserve working
    behavior.
2.  **Phase 1:** Ship the visual shell and design system.
3.  **Phase 2:** Connect real local-model chat and provider settings.
4.  **Phase 5, core subset:** Implement persisted run events and the Run
    Inspector early, so execution is debuggable.
5.  **Phase 3:** Build the workflow graph and editor.
6.  **Phase 4:** Add behavior profiles and Model Driving controls.
7.  **Phase 5, full:** Add robust execution lifecycle, approvals,
    recovery, and cancellation.
8.  **Phase 6:** Add project memory and context budgeting.
9.  **Phase 7:** Add model routing and benchmarks.
10. **Phase 8:** Add candidate evaluation and bounded workflow
    evolution.
11. **Phase 9:** Harden reliability and extensibility.

The Run Inspector is intentionally introduced early. Without
observability, debugging an adaptive agent becomes guesswork.

------------------------------------------------------------------------

# 13. Definition of Done for the First Useful Release

The first release is complete when a user can:

1.  Configure a local OpenAI-compatible model endpoint.
2.  Chat with that model.
3.  Create a project and specify its workspace.
4.  Describe an idea and generate a structured workflow.
5.  Inspect and edit every workflow node and prompt.
6.  Set context, model, retry, tool, verification, and token limits.
7.  Preview the effective prompt and workflow before running.
8.  Execute a task with visible events and tool outputs.
9.  Approve or reject sensitive actions.
10. See exact file changes and verification evidence.
11. Diagnose a failed step and retry only the necessary work.
12. Ask the model to propose a workflow revision.
13. Review, validate, version, and roll back that revision.
14. Compare token use and verified success against a baseline.
15. Stop the run and see the confirmed final state.

A smaller first release may defer automated candidate benchmarking,
advanced routing, and plugins, but it should not fake those capabilities
in the UI.

------------------------------------------------------------------------

# 14. Engineering Rules for the Implementation Agent

-   Inspect before editing.
-   Preserve existing architecture unless the audit proves a change is
    necessary.
-   Implement one phase at a time.
-   Make small, reviewable changes.
-   Add or update tests for each backend behavior.
-   Run relevant tests and report actual results.
-   Never mark an unimplemented feature as complete.
-   Never fabricate model metrics or task progress.
-   Keep secrets out of source code, prompts saved to shared files,
    logs, and exports.
-   Enforce tool permissions in the backend.
-   Validate all model-generated workflow patches.
-   Add migrations for persisted schema changes.
-   Provide a concise change summary, test results, and remaining risks
    after each phase.
-   Do not start a later phase while the current phase has failing
    acceptance-critical tests without documenting and obtaining approval
    for the exception.

## Final Product Goal

Build a controllable local AI workbench in which small models do not
need to solve an entire complex task in one shot. The application should
make their work more structured, observable, testable, recoverable, and
efficient---while keeping the user in control of prompts, workflows,
tools, budgets, and automatic modifications.
