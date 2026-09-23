import { describe, it, expect } from 'vitest';
import { AdoClient } from './client.js';
import { PatTokenProvider } from './auth.js';

interface Captured {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body?: string;
}

function mockFetch(
  handler: (cap: Captured) => { status: number; body: unknown }
): { fetchImpl: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const cap: Captured = {
      url,
      method: init?.method,
      headers: (init?.headers as Record<string, string>) ?? {},
      body: typeof init?.body === 'string' ? init.body : undefined
    };
    calls.push(cap);
    const { status, body } = handler(cap);
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseConfig = {
  organizationUrl: 'https://dev.azure.com/your-org',
  project: 'YourProject',
  auth: new PatTokenProvider('dummy')
};

describe('AdoClient', () => {
  it('maps a work item response into a snapshot', async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 200,
      body: {
        id: 5000498,
        rev: 12,
        fields: {
          'System.Title': '[QC 08117094] Hung/Blank Screen',
          'System.State': 'Resolved',
          'System.WorkItemType': 'Bug'
        }
      }
    }));
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    const wi = await client.getWorkItem(5000498);
    expect(wi.id).toBe(5000498);
    expect(wi.rev).toBe(12);
    expect(wi.title).toContain('Hung/Blank Screen');
    expect(wi.state).toBe('Resolved');
    expect(wi.workItemType).toBe('Bug');
  });

  it('sends a JSON-Patch with an optimistic-concurrency test op on updateFields', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200, body: { id: 1, rev: 13, fields: {} } }));
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    await client.updateFields(1, { 'Custom.Milestone': 'VR' }, 12);

    const call = calls[0];
    expect(call.method).toBe('PATCH');
    expect(call.headers['Content-Type']).toBe('application/json-patch+json');
    const ops = JSON.parse(call.body ?? '[]');
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 12 });
    expect(ops[1]).toEqual({ op: 'add', path: '/fields/Custom.Milestone', value: 'VR' });
  });

  it('throws AdoError with the server message on failure', async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 409, body: { message: 'TF237082: rev conflict' } }));
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    await expect(client.getWorkItem(1)).rejects.toThrow('rev conflict');
  });

  it('uses Basic auth for PAT', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200, body: { id: 1, rev: 1, fields: {} } }));
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    await client.getWorkItem(1);
    expect(calls[0].headers['Authorization']).toMatch(/^Basic /);
  });

  it('reads changed files from the latest pull request iteration', async () => {
    const { fetchImpl, calls } = mockFetch((call) => call.url.includes('/iterations?')
      ? { status: 200, body: { value: [{ id: 1 }, { id: 3 }] } }
      : { status: 200, body: { changeEntries: [{ changeType: 'edit', item: { path: '/src/fix.ts' } }] } });
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    const changes = await client.getPullRequestChanges('repo-id', 7821);
    expect(changes).toHaveLength(1);
    expect(calls[1].url).toContain('/iterations/3/changes?');
  });

  it('retrieves linked build status', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200, body: { id: 42, status: 'completed', result: 'succeeded' } }));
    const client = new AdoClient({ ...baseConfig, fetchImpl });
    const build = await client.getBuild(42);
    expect(build.result).toBe('succeeded');
    expect(calls[0].url).toContain('/build/builds/42?');
  });
});
