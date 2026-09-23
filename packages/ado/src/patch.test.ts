import { describe, it, expect } from 'vitest';
import { buildFieldPatch, buildAddRelationPatch, RELATION_TYPES, workItemApiUrl } from './patch.js';

describe('buildFieldPatch', () => {
  it('prepends an optimistic-concurrency test op when expectedRev is given', () => {
    const ops = buildFieldPatch({ 'Custom.Milestone': 'VR' }, 12);
    expect(ops[0]).toEqual({ op: 'test', path: '/rev', value: 12 });
    expect(ops[1]).toEqual({ op: 'add', path: '/fields/Custom.Milestone', value: 'VR' });
  });

  it('omits the test op when no expectedRev is given', () => {
    const ops = buildFieldPatch({ 'System.State': 'Resolved' });
    expect(ops.every((o) => o.op !== 'test')).toBe(true);
  });

  it('emits a remove op for null values', () => {
    const ops = buildFieldPatch({ 'Custom.Field': null });
    expect(ops[0]).toEqual({ op: 'remove', path: '/fields/Custom.Field' });
  });
});

describe('relations', () => {
  it('builds an add-relation patch with a target url', () => {
    const url = workItemApiUrl('https://dev.azure.com/your-org', 5025165);
    const ops = buildAddRelationPatch(RELATION_TYPES.duplicateOf, url);
    expect(ops[0].op).toBe('add');
    expect(ops[0].path).toBe('/relations/-');
    expect(ops[0].value).toMatchObject({ rel: 'System.LinkTypes.Duplicate-Forward', url });
  });
});
