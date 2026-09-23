import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { ProgramKnowledge, loadProgramConfig } from '@triager/knowledge';
import { MockReasoningProvider, type ReasoningProvider } from '@triager/triage-brain';
import { evaluatePolicy, DEFAULT_POLICY } from '@triager/shared';
import { loadBackendConfig, type BackendConfig } from './config.js';

const PlanRequestSchema = z.object({
  workItem: z.object({
    id: z.number().int().positive(),
    title: z.string().optional(),
    state: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional()
  }),
  transcript: z.array(
    z.object({
      turnId: z.string().min(1),
      speaker: z.string().optional(),
      role: z.enum(['pm', 'engineer', 'partner', 'agent', 'unknown']).optional(),
      text: z.string(),
      ts: z.number(),
      source: z.enum(['mic', 'system']).optional()
    })
  ),
  now: z.number().optional()
});

export interface BuildServerOptions {
  config?: BackendConfig;
}

/** Extract the first JSON object from a model response, tolerant of prose/fences. */
function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Builds the agenttriager service. It exposes triage planning (offline-capable
 * via the deterministic provider) and realtime session minting (keeps long-lived
 * keys off the desktop client). It deliberately does NOT expose raw ADO writes.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadBackendConfig();
  const programConfig = await loadProgramConfig(config.programConfigPath);
  const kb = new ProgramKnowledge(programConfig);
  const provider: ReasoningProvider = new MockReasoningProvider(kb);

  const app = Fastify({
    logger: { level: config.nodeEnv === 'test' ? 'silent' : 'info' },
    bodyLimit: 12 * 1024 * 1024
  });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'agenttriager',
    provider: provider.name,
    aiProvider: config.aiProvider,
    program: programConfig.program,
    time: new Date().toISOString()
  }));

  app.post('/triage/plan', async (req, reply) => {
    const parsed = PlanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', issues: parsed.error.issues });
    }
    const { workItem, transcript, now } = parsed.data;
    const planInput = now === undefined ? { workItem, transcript } : { workItem, transcript, now };
    const { decisions, actions } = await provider.plan(planInput);
    const evaluated = actions.map((action) => ({ action, policy: evaluatePolicy(action, DEFAULT_POLICY) }));
    return { provider: provider.name, decisions, actions: evaluated };
  });

  // Reads a screenshot with a vision model to identify the ADO work item in focus.
  app.post('/vision/analyze', async (req, reply) => {
    const body = req.body as { image?: string; hint?: string };
    if (!body?.image) return reply.code(400).send({ error: 'image is required' });
    if (
      config.aiProvider !== 'azure-openai' ||
      !config.azureEndpoint ||
      !config.azureApiKey ||
      !config.azureReasoningDeployment
    ) {
      return reply.code(501).send({ error: 'Vision is not configured (needs Azure OpenAI reasoning deployment).' });
    }
    const dataUrl = body.image.startsWith('data:') ? body.image : `data:image/jpeg;base64,${body.image}`;
    const url = `${config.azureEndpoint.replace(/\/+$/, '')}/openai/deployments/${config.azureReasoningDeployment}/chat/completions?api-version=${config.azureApiVersion}`;
    const system =
      'You are watching a screen during an Azure DevOps triage meeting. Identify the Azure DevOps ' +
      'work item currently in focus. IDs appear as "BUG 5000498", "#5000498", or in a URL like ' +
      '.../_workitems/edit/5000498. Respond ONLY with compact JSON: ' +
      '{"workItemId": <number or null>, "title": <string or null>, "onScreen": <short description>}.';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': config.azureApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'text', text: body.hint ? `Context: ${body.hint}` : 'What work item is on screen?' },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 200,
          temperature: 0
        })
      });
      if (!res.ok) return reply.code(res.status).send({ error: `vision request failed (${res.status})` });
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      const parsed = extractJson(text) ?? {};
      const rawId = parsed['workItemId'];
      const workItemId = typeof rawId === 'number' ? rawId : Number(rawId) || null;
      return {
        provider: 'azure-openai',
        workItemId,
        title: (parsed['title'] as string | null) ?? null,
        onScreen: (parsed['onScreen'] as string) ?? text
      };
    } catch (err) {
      return reply.code(502).send({ error: 'vision call failed', detail: String(err) });
    }
  });

  app.post('/session', async (_req, reply) => {
    try {
      if (config.aiProvider === 'openai' && config.openaiApiKey) {
        const res = await fetch('https://api.openai.com/v1/realtime/sessions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.realtimeModel })
        });
        return reply.code(res.status).send(await res.json());
      }
      if (
        config.aiProvider === 'azure-openai' &&
        config.azureEndpoint &&
        config.azureApiKey &&
        config.azureRealtimeDeployment
      ) {
        const url = `${config.azureEndpoint.replace(/\/+$/, '')}/openai/realtimeapi/sessions?api-version=${config.azureRealtimeApiVersion}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'api-key': config.azureApiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.azureRealtimeDeployment, voice: 'alloy' })
        });
        const body = (await res.json()) as Record<string, unknown>;
        const webrtcUrl = `https://${config.azureRealtimeRegion}.realtimeapi-preview.ai.azure.com/v1/realtimertc`;
        return reply.code(res.status).send({ ...body, webrtcUrl, deployment: config.azureRealtimeDeployment });
      }
    } catch (err) {
      return reply.code(502).send({ error: 'Failed to mint realtime session', detail: String(err) });
    }
    return reply.code(501).send({
      error: 'Realtime session minting is not configured',
      needed: [
        'AI_PROVIDER=openai|azure-openai',
        'provider endpoint + api key',
        'realtime deployment/model name'
      ]
    });
  });

  return app;
}
