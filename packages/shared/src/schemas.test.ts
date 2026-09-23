import { describe, it, expect } from 'vitest';
import { parseTriageAction, TOOL_CATALOG, allToolDefs } from './index.js';

describe('triage action schemas', () => {
  it('parses a valid update_milestone action', () => {
    const r = parseTriageAction({
      action: 'update_milestone',
      workItemId: 5000498,
      product: 'PROGRAM_B',
      to: 'VR',
      evidence: [{ turnId: 't1', quote: 'keep this for VR' }],
      confidence: 0.95
    });
    expect(r.success).toBe(true);
  });

  it('rejects update_milestone missing the target value', () => {
    const r = parseTriageAction({
      action: 'update_milestone',
      workItemId: 5000498,
      product: 'PROGRAM_B',
      evidence: [],
      confidence: 0.95
    });
    expect(r.success).toBe(false);
  });

  it('applies the default resolve=true for mark_duplicate', () => {
    const r = parseTriageAction({
      action: 'mark_duplicate',
      workItemId: 5000498,
      duplicateOfId: 5025165,
      evidence: [{ turnId: 't1', quote: 'duplicate of 5025165' }],
      confidence: 0.9
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.action === 'mark_duplicate') {
      expect(r.data.resolve).toBe(true);
    }
  });

  it('rejects an unknown action', () => {
    const r = parseTriageAction({ action: 'delete_everything', workItemId: 1 });
    expect(r.success).toBe(false);
  });

  it('every catalog entry has a matching schema and valid risk', () => {
    for (const tool of allToolDefs()) {
      expect(tool.schema).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(tool.risk);
      expect(TOOL_CATALOG[tool.name].name).toBe(tool.name);
    }
  });
});
