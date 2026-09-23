export type AiProvider = 'azure-openai' | 'openai' | 'mock';

export interface BackendConfig {
  port: number;
  nodeEnv: string;
  programConfigPath: string;
  aiProvider: AiProvider;
  openaiApiKey?: string;
  realtimeModel?: string;
  azureEndpoint?: string;
  azureApiKey?: string;
  azureRealtimeDeployment?: string;
  azureReasoningDeployment?: string;
  azureApiVersion: string;
  azureRealtimeApiVersion: string;
  azureRealtimeRegion: string;
}

function optional(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function loadBackendConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const provider = (optional(env.AI_PROVIDER) ?? 'mock') as AiProvider;
  return {
    port: Number(env.PORT ?? 8787),
    nodeEnv: optional(env.NODE_ENV) ?? 'development',
    programConfigPath: optional(env.PROGRAM_CONFIG) ?? 'config/program.json',
    aiProvider: provider,
    openaiApiKey: optional(env.OPENAI_API_KEY),
    realtimeModel: optional(env.OPENAI_REALTIME_MODEL) ?? 'gpt-realtime',
    azureEndpoint: optional(env.AZURE_OPENAI_ENDPOINT),
    azureApiKey: optional(env.AZURE_OPENAI_API_KEY),
    azureRealtimeDeployment: optional(env.AZURE_OPENAI_REALTIME_DEPLOYMENT),
    azureReasoningDeployment: optional(env.AZURE_OPENAI_REASONING_DEPLOYMENT),
    azureApiVersion: optional(env.AZURE_OPENAI_API_VERSION) ?? '2024-10-21',
    azureRealtimeApiVersion: optional(env.AZURE_OPENAI_REALTIME_API_VERSION) ?? '2025-04-01-preview',
    azureRealtimeRegion: optional(env.AZURE_OPENAI_REALTIME_REGION) ?? 'eastus2'
  };
}
