import { describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './server.js';
import { loadBackendConfig } from './config.js';

async function makeApp(): Promise<FastifyInstance> {
  const config = {
    ...loadBackendConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
    programConfigPath: 'config/program.PROGRAM_A.json',
    nodeEnv: 'test'
  };
  return buildServer({ config });
}

describe('agenttriager backend', () => {
  it('reports health', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; provider: string };
    expect(body.status).toBe('ok');
    expect(body.provider).toBe('mock');
    await app.close();
  });

  it('plans actions with policy outcomes attached', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/triage/plan',
      payload: {
        workItem: { id: 5000498 },
        transcript: [
          { turnId: 't0', text: "Let's look at 702 next.", ts: 1 },
          { turnId: 't1', text: 'Joshua is following up with the platform team.', ts: 2 },
          { turnId: 't2', text: 'Keep it for VR.', ts: 3 }
        ]
      }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { provider: string; actions: { action: { action: string }; policy: { outcome: string } }[] };
    expect(body.provider).toBe('mock');
    const names = body.actions.map((a) => a.action.action);
    expect(names).toContain('update_milestone');
    expect(names).toContain('record_action');
    const ms = body.actions.find((a) => a.action.action === 'update_milestone');
    expect(ms?.policy.outcome).toBe('confirm');
    await app.close();
  });

  it('rejects malformed plan requests', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/triage/plan', payload: { workItem: {} } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 501 for session minting when unconfigured', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/session' });
    expect(res.statusCode).toBe(501);
    await app.close();
  });
});
