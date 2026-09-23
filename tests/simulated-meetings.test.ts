import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { ProgramKnowledge, loadProgramConfig } from '@triager/knowledge';
import { MockReasoningProvider } from '@triager/triage-brain';
import type { TranscriptTurn, TriageAction } from '@triager/shared';

let provider: MockReasoningProvider;
const NOW = 1_726_700_000_000;

beforeAll(async () => {
  const cfg = await loadProgramConfig(resolve(process.cwd(), 'config/program.example.json'));
  provider = new MockReasoningProvider(new ProgramKnowledge(cfg));
});

function turns(...texts: string[]): TranscriptTurn[] {
  return texts.map((text, i) => ({ turnId: `t${i}`, text, ts: NOW + i * 1000 }));
}

async function plan(...texts: string[]): Promise<TriageAction[]> {
  const { actions } = await provider.plan({ workItem: { id: 5000498 }, transcript: turns(...texts), now: NOW });
  return actions;
}

describe('simulated meetings (spec §32)', () => {
  it('does NOT open a PartnerCo case when the suggestion is dropped', async () => {
    const actions = await plan('Maybe we should open PartnerCo.', "I don't think so.", "Let's wait for logs.");
    expect(actions.some((a) => a.action === 'create_partner_case')).toBe(false);
  });

  it('does NOT resolve when the resolve is retracted', async () => {
    const actions = await plan('Resolve this.', "No, don't resolve it yet.");
    expect(actions.some((a) => a.action === 'update_state')).toBe(false);
  });

  it('creates exactly one duplicate relationship (with resolve) from a duplicate instruction', async () => {
    const actions = await plan('This is duplicate of 5025165. Resolve this one.');
    const dups = actions.filter((a) => a.action === 'mark_duplicate');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ action: 'mark_duplicate', duplicateOfId: 5025165, resolve: true });
    // Duplicate carries the resolve; there must be no separate state write.
    expect(actions.some((a) => a.action === 'update_state')).toBe(false);
  });

  it('asks for clarification instead of blindly writing an ambiguous milestone', async () => {
    const actions = await plan('This still blocks VR.');
    expect(actions.some((a) => a.action === 'update_milestone')).toBe(false);
    const clar = actions.find((a) => a.action === 'request_clarification');
    expect(clar).toBeDefined();
    if (clar && clar.action === 'request_clarification') {
      expect(clar.options).toEqual(expect.arrayContaining(['PROGRAM_A', 'PROGRAM_B']));
    }
  });

  it('MVP scenario: investigation + owner + milestone with product context', async () => {
    const actions = await plan(
      "Let's look at 702 next.",
      'The bug is still under investigation.',
      'Joshua is following up with the platform team.',
      'Keep it for VR.'
    );
    const milestone = actions.filter((a) => a.action === 'update_milestone');
    expect(milestone).toHaveLength(1);
    expect(milestone[0]).toMatchObject({ product: 'PROGRAM_B', to: 'VR' });

    const record = actions.find((a) => a.action === 'record_action');
    expect(record).toBeDefined();
    if (record && record.action === 'record_action') expect(record.owner).toBe('Joshua');

    expect(actions.some((a) => a.action === 'append_investigation_status')).toBe(true);
  });

  it('opens a partner case only after explicit confirmation, under the right program', async () => {
    const actions = await plan(
      "This looks like a PROGRAM_A PartnerCo issue, let's open a PC case.",
      'Yes, go ahead.'
    );
    const partner = actions.find((a) => a.action === 'create_partner_case');
    expect(partner).toBeDefined();
    if (partner && partner.action === 'create_partner_case') {
      expect(partner.partner).toBe('PartnerCases');
      expect(partner.program).toBe('PROGRAM_A-PC');
    }
  });
});
