/**
 * Pluggable Azure DevOps auth. PAT for quick dev; Entra (Azure CLI identity or a
 * device-code app registration) for enterprise. Tokens are never logged or persisted.
 */

export interface AccessTokenProvider {
  getAuthHeader(): Promise<string>;
}

/** Azure DevOps resource app id — constant across tenants. */
export const ADO_RESOURCE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

export class PatTokenProvider implements AccessTokenProvider {
  constructor(private readonly pat: string) {}
  async getAuthHeader(): Promise<string> {
    const token = Buffer.from(`:${this.pat}`).toString('base64');
    return `Basic ${token}`;
  }
}

/** Structural type matching @azure/identity's TokenCredential, so this module
 *  does not hard-depend on the package at type-check time. */
export interface TokenCredentialLike {
  getToken(
    scopes: string | string[]
  ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

export class EntraTokenProvider implements AccessTokenProvider {
  private cached?: { token: string; expiresOnMs: number };
  constructor(private readonly credential: TokenCredentialLike) {}

  async getAuthHeader(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresOnMs - now > 60_000) {
      return `Bearer ${this.cached.token}`;
    }
    const res = await this.credential.getToken(ADO_RESOURCE_SCOPE);
    if (!res) throw new Error('Failed to acquire Entra token for Azure DevOps');
    this.cached = { token: res.token, expiresOnMs: res.expiresOnTimestamp };
    return `Bearer ${this.cached.token}`;
  }
}

export interface AdoAuthConfig {
  mode: 'pat' | 'entra' | 'azcli';
  pat?: string;
  tenantId?: string;
  clientId?: string;
}

/**
 * Factory that resolves an auth provider from config. @azure/identity is imported
 * lazily so PAT/mock flows never load it.
 */
export async function createAdoAuth(config: AdoAuthConfig): Promise<AccessTokenProvider> {
  if (config.mode === 'pat') {
    if (!config.pat) throw new Error('ADO_PAT is required for pat auth mode');
    return new PatTokenProvider(config.pat);
  }

  const identity = await import('@azure/identity');

  if (config.mode === 'azcli') {
    return new EntraTokenProvider(new identity.AzureCliCredential());
  }

  // entra: app registration with user_impersonation (device code keeps it headless-friendly)
  if (!config.tenantId || !config.clientId) {
    throw new Error('AAD_TENANT_ID and AAD_CLIENT_ID are required for entra auth mode');
  }
  const cred = new identity.DeviceCodeCredential({
    tenantId: config.tenantId,
    clientId: config.clientId,
    userPromptCallback: (info) => {
      // Instructs the operator how to complete interactive sign-in.
      console.log(info.message);
    }
  });
  return new EntraTokenProvider(cred);
}
