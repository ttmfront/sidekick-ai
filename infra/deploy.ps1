# =====================================================================
# agenttriager infrastructure deployment (RUN MANUALLY, AFTER REVIEW).
# Defaults target "Azure subscription 1". Always run -WhatIf first.
# =====================================================================
[CmdletBinding()]
param(
  [string]$SubscriptionId = '00000000-0000-0000-0000-000000000000',
  [string]$ResourceGroup = 'agenttriager-rg',
  [string]$Location = 'eastus',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Subscription : $SubscriptionId"
Write-Host "ResourceGroup: $ResourceGroup"
Write-Host "Location     : $Location"

az account set --subscription $SubscriptionId
az group create --name $ResourceGroup --location $Location | Out-Null

$common = @(
  '--resource-group', $ResourceGroup,
  '--template-file', (Join-Path $here 'main.bicep'),
  '--parameters', (Join-Path $here 'main.parameters.json')
)

if ($WhatIf) {
  Write-Host "`nRunning what-if (no changes will be made)..." -ForegroundColor Cyan
  az deployment group what-if @common
} else {
  Write-Host "`nDeploying..." -ForegroundColor Yellow
  az deployment group create @common
}
