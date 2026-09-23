import { describe, it, expect } from 'vitest';
import { evaluatePolicy, DEFAULT_POLICY, type PolicyConfig } from './policy.js';
import type { TriageAction } from './schemas.js';

const ev = [{ turnId: 't1', quote: 'evidence' }];

describe('evaluatePolicy', () => {
  it('auto-approves low-risk record_action', () => {
    const a: TriageAction = { action: 'record_action', workItemId: 1, owner: 'Vivek', task: 'collect ETL', evidence: ev, confidence: 0.8 };
    expect(evaluatePolicy(a).outcome).toBe('auto');
  });

  it('requires confirmation for medium-risk milestone by default', () => {
    const a: TriageAction = { action: 'update_milestone', workItemId: 1, product: 'PROGRAM_B', to: 'VR', evidence: ev, confidence: 0.96 };
    expect(evaluatePolicy(a).outcome).toBe('confirm');
  });

  it('auto-approves medium-risk when policy allows and confidence is high', () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, autoExecuteMediumRisk: true, mediumRiskAutoThreshold: 0.9 };
    const a: TriageAction = { action: 'update_milestone', workItemId: 1, product: 'PROGRAM_B', to: 'VR', evidence: ev, confidence: 0.96 };
    expect(evaluatePolicy(a, cfg).outcome).toBe('auto');
  });

  it('downgrades low-confidence writes to clarification', () => {
    const a: TriageAction = { action: 'append_investigation_status', workItemId: 1, text: 'x', evidence: ev, confidence: 0.3 };
    expect(evaluatePolicy(a).outcome).toBe('clarify');
  });

  it('always confirms high-risk mark_duplicate even at high confidence', () => {
    const a: TriageAction = { action: 'mark_duplicate', workItemId: 1, duplicateOfId: 2, resolve: true, evidence: ev, confidence: 0.99 };
    expect(evaluatePolicy(a).outcome).toBe('confirm');
  });

  it('confirms partner egress and never auto-sends by default', () => {
    const a: TriageAction = { action: 'send_partner_message', workItemId: 1, message: 'hi partnerco', evidence: ev, confidence: 0.99 };
    const r = evaluatePolicy(a);
    expect(r.outcome).toBe('confirm');
    expect(r.risk).toBe('high');
  });

  it('routes explicit clarification requests to clarify', () => {
    const a: TriageAction = { action: 'request_clarification', question: 'PROGRAM_B or PROGRAM_A?', evidence: ev, confidence: 0.5 };
    expect(evaluatePolicy(a).outcome).toBe('clarify');
  });

  it('treats no_op as auto (no side effect)', () => {
    const a: TriageAction = { action: 'no_op', reason: 'discussion reversed' };
    expect(evaluatePolicy(a).outcome).toBe('auto');
  });
});
