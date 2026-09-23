import { InteractiveBrowserCredential } from '@azure/identity';
import { EntraTokenProvider, type AccessTokenProvider } from '@triager/ado';

// Azure CLI's well-known public client id: a multi-tenant public client with a
// loopback redirect already registered, and consent to call Azure DevOps.
// Using it lets the user sign in interactively without registering a new app.
const AZURE_CLI_CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';
const ADO_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

export interface SignedInAccount {
  username: string;
  name?: string;
  tenantId?: string;
}

/**
 * Manages interactive Entra sign-in in the Electron main process. The system
 * browser opens for authentication; the resulting token never leaves main and
 * is exposed to ADO only through an AccessTokenProvider.
 */
export class AuthManager {
  private credential?: InteractiveBrowserCredential;
  private provider?: AccessTokenProvider;
  private account?: SignedInAccount;

  get isSignedIn(): boolean {
    return Boolean(this.account);
  }
  get currentAccount(): SignedInAccount | undefined {
    return this.account;
  }
  get tokenProvider(): AccessTokenProvider | undefined {
    return this.provider;
  }

  async signIn(): Promise<SignedInAccount> {
    this.credential = new InteractiveBrowserCredential({
      clientId: AZURE_CLI_CLIENT_ID,
      tenantId: 'organizations',
      additionallyAllowedTenants: ['*']
    });
    const token = await this.credential.getToken(ADO_SCOPE);
    if (!token) throw new Error('Sign-in did not return a token');
    this.account = decodeAccount(token.token);
    this.provider = new EntraTokenProvider(this.credential);
    return this.account;
  }

  signOut(): void {
    this.credential = undefined;
    this.provider = undefined;
    this.account = undefined;
  }
}

function decodeAccount(jwt: string): SignedInAccount {
  try {
    const part = jwt.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
    const username = (payload.upn ??
      payload.unique_name ??
      payload.preferred_username ??
      payload.email ??
      'unknown') as string;
    const result: SignedInAccount = { username };
    if (typeof payload.name === 'string') result.name = payload.name;
    if (typeof payload.tid === 'string') result.tenantId = payload.tid;
    return result;
  } catch {
    return { username: 'unknown' };
  }
}
