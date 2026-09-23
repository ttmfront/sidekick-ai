# Implementation Status

Living status doc (per spec §37). Legend: ✅ done · 🟡 in progress · ⛔ blocked · ⬜ next/planned

_Last updated: 2026-09-22_

## Azure deployment (agenttriager)  ✅ LIVE

Deployed to an Azure subscription / resource group of your choosing (local `config/deployment.json`, gitignored):

| Resource | Name | Region | Notes |
|---|---|---|---|
| App Service (Node 20) | **agenttriager** | eastus | https://your-app.azurewebsites.net — `/health` + `/triage/plan` verified live |
| Azure OpenAI | your-openai-account | **eastus2** | realtime=`gpt-realtime` 2025-08-28, reasoning=`gpt-4o` 2024-11-20 |
| Key Vault (RBAC) | your-keyvault | eastus | web app identity granted Secrets User |
| App Insights + Log Analytics | agenttriager-ai / -law | eastus | telemetry |

OpenAI placed in eastus2 because realtime models aren't offered in eastus (validated via `az cognitiveservices model list`). App identity has *Cognitive Services OpenAI User* on the account.

## Phase 0 — Scaffold, shared contracts, test harness  ✅

**Validation:** `npm run typecheck` clean · `npm test` → 52 passing (11 files) · desktop/backend bundle with tsup · Bicep compiles (exit 0) · live `/health` + `/triage/plan` verified over HTTP.

| Item | Status | Notes |
|---|---|---|
| Monorepo (npm workspaces) + TS + Vitest 4 | ✅ | typecheck + tests green |
| `@triager/shared` — types, Zod action schemas, tool catalog, risk policy | ✅ | 13 tests |
| `@triager/knowledge` — program KB (products/milestones/glossary/partners) | ✅ | 6 tests |
| `@triager/ado` — REST adapter + schema discovery | ✅ | real REST, pluggable auth (PAT/Entra/azcli), optimistic concurrency; 12 tests |
| `@triager/triage-brain` — decision-settling + action planner + mock provider | ✅ | 2 unit tests + 6 integration |
| `apps/backend` — agenttriager Fastify (`/health`, `/session`, `/triage/plan`) | ✅ | Fastify 5; 4 tests; runs live |
| `infra/` — Bicep for agenttriager (author only, no deploy) | ✅ | new Azure OpenAI, App Service `agenttriager`, KeyVault, App Insights; eastus; compiles |
| `config/` — program config, ado-schema scaffold, approval rules | ✅ | PROGRAM_A program, System.* mapped, custom fields await discovery |
| `tests/` — simulated meetings (§32) | ✅ | VR/QCC settling, no-PartnerCo, no-resolve, duplicate, ambiguity clarify, MVP scenario, partner-confirm |

## Phase 1 — ADO connect + query browser + read-only UI  🟡

**Electron desktop app built** ([apps/desktop](apps/desktop)) and verified to launch (`[renderer] loaded OK`):
- Interactive **Microsoft sign-in** in the main process via `InteractiveBrowserCredential` (Azure CLI public client, tenant `organizations`) → acquires an ADO token; token stays in main, never in the renderer.
- Read-only UI: connection/account status, program/project/query bar, work-item list (from the configured query), work-item detail pane, and a **Discover schema** action that maps ADO field reference names.
- ADO client extended with `getQueryByPath` / `runQueryById` / `getWorkItemsBatch`; `queryPath` added to program config.
- Run: `npm run dev --workspace @triager/desktop` (build + launch).

**Pending live validation (your action):** sign in with an account that has `your-org` access; if the query path differs from `Shared Queries/Products/PROGRAM_B/TEAM_SPRINT_QUERY`, update `queryPath` in [config/program.PROGRAM_A.json](config/program.PROGRAM_A.json).

## Phase 2 — ADO write engine (fields/comments/investigation/relations, diff, approval, audit)  ✅

Meeting panel wired into the desktop app: a transcript (typed **or** spoken) is analyzed → proposed
actions show **risk / policy outcome / confidence / evidence / before→after diff** → **Approve & apply**
executes the real ADO write (optimistic concurrency), logged in an **audit timeline**. Custom-field writes
resolve reference names from Discover schema (never guessed); System writes (state/comment/duplicate/related)
work without discovery. See `apps/desktop/src/main/executor.ts`.

Write tool calls now default to an inline **Confirm / Edit / Cancel** proposal. State and duplicate changes
remain high risk. Every attempted execution is audited in Electron main with action name, work-item ID,
result, and ADO revisions; payload text and credentials are not persisted in audit records.

## Engineering intelligence — ADO as a dynamic knowledge source  ✅ (live tenant validation pending)

- Structured meeting context tracks the current item, component, platform, release, investigation,
	mentioned bugs/PRs/people, decisions, blockers, questions, and action items.
- Related-item search uses cross-project WIQL candidates and ranks title, description, repro, tags, and
	component evidence. Empty results and ADO failures are distinct typed outcomes.
- Work-item inspection retrieves fields, comments, update history, attachments, linked PR status,
	author/reviewers, commit/change/comment counts, and linked build validation.
- Inspecting a historical bug does not replace the current meeting work item. Linked-resource permission
	failures are returned as warnings rather than being misreported as no match.
- The compact Sidekick UI shows current context, clickable related intelligence, typed/voice conversation,
	confirmation cards, and durable action history.

## Phase 3 & 4 — Meeting intelligence + realtime voice  🟡 (wired; needs in-meeting validation)

Realtime voice via **WebRTC to Azure OpenAI `gpt-realtime`**: mic capture (Chromium `getUserMedia`,
echo cancellation), the agent **speaks** and **transcribes** both sides into the transcript. Ephemeral
credentials are minted server-side by the deployed backend `/session` and SDP is relayed through the
Electron main process — the realtime key never touches the renderer. System/meeting-audio loopback and
barge-in tuning are the remaining Phase 3/4 items. (Audio can't be validated in this environment — needs
a live mic test.)
## Phase 5 — Partner workflows (PC case create, partner-id polling, title, Partner Discussion, attachments)  🟡

A provider interface and draft-only fallback are implemented. It can pre-populate a partner payload from
the current ADO bug and inspect mapped Partner Discussion data, but it explicitly does **not** claim or
perform external case creation. Real case search/create/update and attachment upload remain blocked on a
partner-system API/MCP connector.
## Phase 6 — Autonomy (safe auto-update policies, auto next-item, meeting summary, recovery)  ⬜

---

## COMPLETED
- Environment validated (Node 20.18, .NET 9.0.318, az 2.58, git 2.55, Win11).
- Architecture approved; provider = new Azure OpenAI under `agenttriager-rg`; ADO dev auth = Entra app (azcli fallback); Bicep author-now/deploy-later; region eastus.
- **Phase 0 complete**: monorepo, shared contracts + policy engine, program knowledge, ADO adapter, decision-settling triage brain, agenttriager backend, Bicep, config, and full test harness — all validated.
- Security: runtime Fastify advisories fixed (5.12.4); only 1 low-severity build-time `esbuild` (tsup) advisory remains — dev/build-only, non-exploitable in our usage.

## IN PROGRESS
- (none) — awaiting go-ahead for Phase 1.

## BLOCKED
- **Live ADO against `your-org`**: your `az login` (a personal-tenant account) mints an ADO token but is **403** on `your-org` (a different corporate tenant). The `azcli` auth path is validated as mechanically working — it's an authorization/identity mismatch. To read/write real work items, use one of: (a) sign in with an account that owns the ADO org, (b) a **PAT** generated from that account (`ADO_AUTH_MODE=pat`), or (c) point at an ADO org the current identity can access for dev.
- Realtime `/session` minting returns 501 until the managed-identity token path (or an API key) is wired — Phase 3/4.

## NEXT (Phase 1)
- You sign in with an authorized account in the app to validate live query/work-item loading + schema discovery against `your-org`. Then Phase 2 (write engine with diff/approval) and Phase 3 (meeting audio + realtime) follow.
