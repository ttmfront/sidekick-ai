export type FieldValue = string | number | boolean | null;

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
}

/** ADO relation reference names. */
export const RELATION_TYPES = {
  related: 'System.LinkTypes.Related',
  /** This item is "Duplicate Of" the target. */
  duplicateOf: 'System.LinkTypes.Duplicate-Forward',
  /** The target is a duplicate of this item. */
  duplicate: 'System.LinkTypes.Duplicate-Reverse',
  parent: 'System.LinkTypes.Hierarchy-Reverse',
  child: 'System.LinkTypes.Hierarchy-Forward'
} as const;

/**
 * Build a JSON Patch for field changes. When `expectedRev` is provided, a `test`
 * op on `/rev` is prepended so ADO rejects the write if the item changed since we
 * read it (optimistic concurrency — never blind-overwrite).
 */
export function buildFieldPatch(
  changes: Record<string, FieldValue>,
  expectedRev?: number
): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  if (typeof expectedRev === 'number') {
    ops.push({ op: 'test', path: '/rev', value: expectedRev });
  }
  for (const [ref, value] of Object.entries(changes)) {
    if (value === null) {
      ops.push({ op: 'remove', path: `/fields/${ref}` });
    } else {
      ops.push({ op: 'add', path: `/fields/${ref}`, value });
    }
  }
  return ops;
}

export function buildAddRelationPatch(
  rel: string,
  url: string,
  attributes?: Record<string, unknown>
): JsonPatchOp[] {
  return [{ op: 'add', path: '/relations/-', value: { rel, url, attributes: attributes ?? {} } }];
}

export function buildRemoveRelationPatch(index: number): JsonPatchOp[] {
  return [{ op: 'remove', path: `/relations/${index}` }];
}

/** REST URL of a work item, used as the target of a relation. */
export function workItemApiUrl(organizationUrl: string, id: number): string {
  const org = organizationUrl.replace(/\/+$/, '');
  return `${org}/_apis/wit/workItems/${id}`;
}
