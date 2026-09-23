// =====================================================================
// agenttriager backend infrastructure (AUTHORED — not deployed until approved)
// Deploy target: Azure subscription 1 (00000000-0000-0000-0000-000000000000)
// Creates: Log Analytics, App Insights, Linux App Service (Node 20) named
// "agenttriager", Key Vault (RBAC), Azure OpenAI + realtime & reasoning deployments,
// and managed-identity role assignments. App resources in eastus; Azure OpenAI in
// eastus2 (realtime-capable). Validated model availability before authoring.
// =====================================================================

@description('Azure region for all resources.')
param location string = 'eastus'

@description('Region for the Azure OpenAI account. Must support the realtime model (eastus2/swedencentral). Kept separate so the app can stay in eastus.')
param openAiLocation string = 'eastus2'

@description('Base name; the web app is named exactly this.')
param namePrefix string = 'agenttriager'

@description('App Service plan SKU.')
param appServiceSku string = 'B1'

@description('Azure OpenAI realtime model + version (validate availability in the region).')
param openAiRealtimeModel string = 'gpt-realtime'
param openAiRealtimeModelVersion string = '2025-08-28'

@description('Azure OpenAI reasoning model + version.')
param openAiReasoningModel string = 'gpt-4o'
param openAiReasoningModelVersion string = '2024-11-20'

var lawName = '${namePrefix}-law'
var appInsightsName = '${namePrefix}-ai'
var planName = '${namePrefix}-plan'
var webAppName = namePrefix
var kvName = take(toLower('${namePrefix}kv${uniqueString(resourceGroup().id)}'), 24)
var openAiName = toLower('${namePrefix}-openai-${uniqueString(resourceGroup().id)}')

// Built-in role definition IDs
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

resource openai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiName
  location: openAiLocation
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: openAiName
    publicNetworkAccess: 'Enabled'
  }
}

resource realtimeDeploy 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'realtime'
  sku: { name: 'GlobalStandard', capacity: 1 }
  properties: {
    model: { format: 'OpenAI', name: openAiRealtimeModel, version: openAiRealtimeModelVersion }
  }
}

resource reasoningDeploy 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openai
  name: 'reasoning'
  // Deployments on one account must be created serially.
  dependsOn: [ realtimeDeploy ]
  sku: { name: 'GlobalStandard', capacity: 30 }
  properties: {
    model: { format: 'OpenAI', name: openAiReasoningModel, version: openAiReasoningModelVersion }
  }
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    publicNetworkAccess: 'Enabled'
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: { name: appServiceSku }
  kind: 'linux'
  properties: { reserved: true }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'AI_PROVIDER', value: 'azure-openai' }
        { name: 'AZURE_OPENAI_ENDPOINT', value: openai.properties.endpoint }
        { name: 'AZURE_OPENAI_REALTIME_DEPLOYMENT', value: 'realtime' }
        { name: 'AZURE_OPENAI_REASONING_DEPLOYMENT', value: 'reasoning' }
        { name: 'AZURE_OPENAI_API_VERSION', value: '2024-10-21' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
        { name: 'KEY_VAULT_URI', value: kv.properties.vaultUri }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
      ]
    }
  }
}

resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, web.id, 'kv-secrets-user')
  scope: kv
  properties: {
    principalId: web.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource openAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openai.id, web.id, 'openai-user')
  scope: openai
  properties: {
    principalId: web.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

output webAppName string = web.name
output webAppUrl string = 'https://${web.properties.defaultHostName}'
output openAiEndpoint string = openai.properties.endpoint
output keyVaultUri string = kv.properties.vaultUri
output resourceGroupName string = resourceGroup().name
