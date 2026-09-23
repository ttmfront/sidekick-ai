# agenttriager — backend infrastructure

Infrastructure-as-Code for the **agenttriager** backend. **Authored now, deployed later**
after review. Nothing here runs automatically.

## What it provisions (in `agenttriager-rg`, region `eastus`)

- **App Service (Linux, Node 20)** web app named **`agenttriager`** (system-assigned identity)
- **Azure OpenAI** account with two deployments: `realtime` and `reasoning`
- **Key Vault** (RBAC) — secrets store; web app identity gets *Key Vault Secrets User*
- **Application Insights** + **Log Analytics** — telemetry
- Role assignment: web app identity → *Cognitive Services OpenAI User*

## Pre-deploy checklist

1. Confirm the Azure OpenAI **model name/version are available in `eastus`**
   (`az cognitiveservices account list-models`), or override the `openAiRealtimeModel*` /
   `openAiReasoningModel*` parameters.
2. Ensure your account can create Cognitive Services + role assignments in the subscription.

## Deploy (manual)

```powershell
# 1. Preview only — no changes
./deploy.ps1 -WhatIf

# 2. Apply
./deploy.ps1
```

## Publish the backend app

The backend bundles its workspace deps via tsup, so only third-party runtime deps ship.

```powershell
# from repo root
npm run build:backend            # -> apps/backend/dist/index.js

# stage a minimal deployable (dist + a trimmed package.json with prod deps) then:
az webapp deploy --resource-group agenttriager-rg --name agenttriager `
  --src-path backend.zip --type zip
```

Secrets (e.g. ADO app credentials) go into Key Vault and are referenced by the web app via
`@Microsoft.KeyVault(...)` app settings — never committed to the repo.
