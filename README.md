# Agent Triager — AI ADO Triage Program Manager

A Windows desktop agent that sits in live engineering triage meetings, understands which
Azure DevOps work item is being discussed, extracts settled engineering decisions from the
conversation, and updates Azure DevOps through **validated, policy-gated, auditable** workflows.
It can optionally participate by voice.

> **Principle:** the LLM decides *what* should happen; deterministic code decides *how*.
> The realtime/voice model never writes to ADO directly — only via structured, Zod-validated,
> policy-checked tool calls.

## Monorepo layout

```
agent-triager/
  apps/
    backend/            "agenttriager" Fastify service (deployed separately to Azure)
    desktop/            Electron + React desktop client            (Phase 1+)
  packages/
    shared/             domain types, Zod action schemas, tool catalog, risk policy
    knowledge/          program knowledge base (products, milestones, glossary, partners)
    ado/                Azure DevOps REST adapter + schema discovery
    triage-brain/       transcript -> classified utterances -> settled decisions -> actions
    realtime/           OpenAI / Azure OpenAI realtime client       (Phase 3+)
    audio/              mic + system loopback capture / mixing      (Phase 3+)
  infra/                Bicep + scripts for the agenttriager backend (authored, not deployed)
  config/               program config, ado-schema mapping, approval rules
  tests/                simulated-meeting integration tests
```

## Prerequisites

- Node.js >= 20 (validated: v20.18.0)
- npm >= 10 (validated: 11.12.0)
- .NET 9 SDK (optional, for the WASAPI audio sidecar in later phases)
- Azure CLI (for backend deployment, later)

## Getting started

```powershell
npm install
npm run typecheck
npm test
```

Copy `.env.example` to `.env` and fill in values as you enable live integrations.
See `IMPLEMENTATION_STATUS.md` for phase-by-phase progress.

## Safety & data handling

- No secrets in source. Local secrets via `.env` (gitignored) / Windows Credential Manager;
  cloud secrets via Azure Key Vault.
- Raw meeting audio is not persisted by default.
- High-risk ADO actions (resolve/close, mark duplicate, create partner case, send Partner
  Discussion) always require explicit confirmation.
