import { describe, it, expect } from 'vitest';
import { ProgramKnowledge, parseProgramConfig } from '@triager/knowledge';
import { analyzeTranscript } from './analyze.js';
import type { TranscriptTurn } from '@triager/shared';

// Single-product program isolates decision-settling from product ambiguity.
const kb = new ProgramKnowledge(
  parseProgramConfig({
    program: 'SOLO',
    organizationUrl: 'https://dev.azure.com/your-org',
    project: 'YourProject',
    queryName: 'Q',
    products: [{ id: 'SOLO_PROD', aliases: ['solo'] }],
    milestones: [
      { code: 'VR', name: 'Validation Ready' },
      { code: 'QCC', name: 'Quality Control Check' }
    ]
  })
);

function turns(...texts: string[]): TranscriptTurn[] {
  return texts.map((text, i) => ({ turnId: `t${i}`, text, ts: 1_726_700_000_000 + i * 1000 }));
}

describe('decision settling', () => {
  it('collapses VR -> QCC -> VR into a single VR milestone action', () => {
    const { actions } = analyzeTranscript(
      { workItem: { id: 5000498 }, transcript: turns('Keep this for VR.', 'Wait, I meant QCC.', 'Actually we decided VR.'), now: 1_726_700_000_000 },
      kb
    );
    const milestone = actions.filter((a) => a.action === 'update_milestone');
    expect(milestone).toHaveLength(1);
    expect(milestone[0]).toMatchObject({ action: 'update_milestone', to: 'VR', product: 'SOLO_PROD' });
  });

  it('produces no resolve action when the resolve is retracted', () => {
    const { actions } = analyzeTranscript(
      { workItem: { id: 1 }, transcript: turns('Resolve this.', "No, don't resolve it yet."), now: 1_726_700_000_000 },
      kb
    );
    expect(actions.some((a) => a.action === 'update_state')).toBe(false);
  });
});
