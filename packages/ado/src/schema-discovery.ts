/** Minimal structural view of an ADO field definition. */
export interface AdoFieldMeta {
  referenceName: string;
  name: string;
  type?: string;
}

export interface SchemaFieldEntry {
  friendlyName: string;
  referenceName: string | null;
  type: string | null;
  discovered: boolean;
  confidence?: number;
}

export interface AdoSchema {
  organizationUrl: string;
  project: string;
  fields: Record<string, SchemaFieldEntry>;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Best-effort match of a friendly label to an ADO field by normalized name.
 * Returns the candidate and a confidence in [0,1]; null when nothing plausible.
 */
export function matchFriendlyToField(
  friendlyName: string,
  fields: AdoFieldMeta[]
): { field: AdoFieldMeta; confidence: number } | null {
  const target = norm(friendlyName);
  if (!target) return null;
  let best: { field: AdoFieldMeta; confidence: number } | null = null;
  for (const f of fields) {
    const fn = norm(f.name);
    if (!fn) continue;
    if (fn === target) return { field: f, confidence: 1 };
    if (fn.includes(target) || target.includes(fn)) {
      const conf = (Math.min(target.length, fn.length) / Math.max(target.length, fn.length)) * 0.9;
      if (!best || conf > best.confidence) best = { field: f, confidence: conf };
    }
  }
  return best;
}

/**
 * Fill referenceName/type for undiscovered custom fields by matching friendly
 * labels against the org's field definitions. Only assigns matches at/above
 * `minConfidence`; everything else stays undiscovered for manual mapping.
 */
export function reconcileSchema(
  schema: AdoSchema,
  fields: AdoFieldMeta[],
  minConfidence = 0.8
): AdoSchema {
  const out: AdoSchema = { ...schema, fields: { ...schema.fields } };
  for (const [key, entry] of Object.entries(out.fields)) {
    if (entry.discovered && entry.referenceName) continue;
    const m = matchFriendlyToField(entry.friendlyName, fields);
    if (m && m.confidence >= minConfidence) {
      out.fields[key] = {
        ...entry,
        referenceName: m.field.referenceName,
        type: m.field.type ?? entry.type,
        discovered: true,
        confidence: m.confidence
      };
    }
  }
  return out;
}

/** Fields that still need a human mapping decision. */
export function undiscoveredFields(schema: AdoSchema): string[] {
  return Object.entries(schema.fields)
    .filter(([, e]) => !e.discovered || !e.referenceName)
    .map(([k]) => k);
}
