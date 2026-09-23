import type {
  DecisionRecord,
  DecisionType,
  DecisionStatus,
  Evidence,
  TranscriptTurn,
  TriageAction
} from '@triager/shared';
import type { ProgramKnowledge } from '@triager/knowledge';

export interface PlanInput {
  workItem: { id: number; title?: string; state?: string; fields?: Record<string, unknown> };
  transcript: TranscriptTurn[];
  /** Injectable clock for deterministic dated output in tests. */
  now?: number;
}

export interface AnalysisResult {
  decisions: DecisionRecord[];
  actions: TriageAction[];
}

const NEGATION = /\b(no|not|don'?t|do not|never mind|cancel|hold off|wait)\b/i;
const AFFIRM = /\b(yes|yeah|yep|do it|go ahead|sounds good|please do|confirm(ed)?|agree(d)?|correct)\b/i;
const FACT_KEYWORDS =
  /\b(under investigation|still (failing|reproduc\w*)|reproduc\w*|suspect\w*|blocks?|blocked on|waiting|GPIO|BSP|ETL|hang\w*|blank screen)\b/i;
const NAME_STOP = new Set([
  'This', 'That', 'There', 'It', 'We', 'They', 'He', 'She', 'The', 'A', 'I',
  'PartnerCo', 'PC', 'PlatformTeam', 'And', 'But', 'So', 'Let', 'Lets', 'Wait', 'Actually', 'Maybe', 'Keep'
]);

function ev(turn: TranscriptTurn): Evidence {
  return turn.speaker
    ? { turnId: turn.turnId, speaker: turn.speaker, quote: turn.text }
    : { turnId: turn.turnId, quote: turn.text };
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function dedupeJoin(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.replace(/\s+/g, ' ').trim();
    const key = p.toLowerCase();
    if (p && !seen.has(key)) {
      seen.add(key);
      out.push(/[.!?]$/.test(p) ? p : `${p}.`);
    }
  }
  return out.join(' ');
}

function uniqueEvidence(evs: Evidence[]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of evs) {
    if (!seen.has(e.turnId)) {
      seen.add(e.turnId);
      out.push(e);
    }
  }
  return out;
}

function mkDecision(
  type: DecisionType,
  key: string,
  value: string | null,
  status: DecisionStatus,
  evidence: Evidence[],
  confidence: number,
  now: number,
  product?: string
): DecisionRecord {
  return product
    ? { id: `${type}:${key}`, type, key, value, status, product, evidence, confidence, updatedAt: now }
    : { id: `${type}:${key}`, type, key, value, status, evidence, confidence, updatedAt: now };
}

/**
 * Rule-based meeting analyzer: the deterministic reasoning fallback (and the
 * engine the simulated-meeting tests run against). It settles evolving decisions
 * so contradictory statements collapse to a single action, and downgrades
 * ambiguous product references to a clarification instead of a blind write.
 *
 * A production reasoning provider (Azure OpenAI) implements the same
 * ReasoningProvider contract and supersedes this at runtime.
 */
export function analyzeTranscript(input: PlanInput, kb: ProgramKnowledge): AnalysisResult {
  const workItemId = input.workItem.id;
  const now = input.now ?? Date.now();

  const milestones = new Map<string, { code: string; evidence: Evidence[]; cancelled: boolean }>();
  let productContext: string | null = null;

  let resolve: { state: 'none' | 'settled' | 'cancelled'; evidence: Evidence[] } = { state: 'none', evidence: [] };
  let duplicate: { ofId?: number; resolve: boolean; evidence: Evidence[] } = { resolve: false, evidence: [] };
  let partner: { state: 'none' | 'tentative' | 'confirmed' | 'cancelled'; evidence: Evidence[] } = {
    state: 'none',
    evidence: []
  };
  const owners: Array<{ owner: string; task: string; evidence: Evidence[] }> = [];
  const facts: Array<{ text: string; evidence: Evidence[] }> = [];

  for (const turn of input.transcript) {
    const text = turn.text.trim();
    if (!text) continue;

    const products = kb.findProductsInText(text);
    if (products.length === 1) productContext = products[0] ?? productContext;

    const negated = NEGATION.test(text);
    const affirmed = AFFIRM.test(text) && !negated;

    // --- milestone (latest statement wins; negation cancels) ---
    const ms = kb.resolveMilestone(text);
    if (ms) {
      const key = products.length === 1 ? (products[0] as string) : '';
      if (negated) {
        const cur = milestones.get(key);
        if (cur) cur.cancelled = true;
      } else {
        milestones.set(key, { code: ms, evidence: [ev(turn)], cancelled: false });
      }
    }

    // --- duplicate ---
    const dup = /\bduplicate of\b\s*#?(\d{3,})/i.exec(text);
    if (dup) {
      duplicate = { ofId: Number(dup[1]), resolve: /\bresolve/i.test(text), evidence: [ev(turn)] };
    }

    // --- standalone resolve (duplicate handles its own resolve) ---
    if (!dup && /\bresolve[sd]?\b/i.test(text)) {
      resolve = negated
        ? { state: 'cancelled', evidence: [...resolve.evidence, ev(turn)] }
        : { state: 'settled', evidence: [ev(turn)] };
    }

    // --- partner case (always needs explicit confirmation to become an action) ---
    if (/\bpartnerco\b|\bPC case\b|\bpartner case\b/i.test(text)) {
      if (negated) partner = { state: 'cancelled', evidence: [...partner.evidence, ev(turn)] };
      else if (affirmed) partner = { state: 'confirmed', evidence: [...partner.evidence, ev(turn)] };
      else partner = { state: 'tentative', evidence: [ev(turn)] };
    } else if (partner.state === 'tentative' && (negated || affirmed)) {
      partner = {
        state: negated ? 'cancelled' : 'confirmed',
        evidence: [...partner.evidence, ev(turn)]
      };
    }

    // --- owner / action item ---
    const ownerMatch = /\b([A-Z][a-z]{1,20})\s+(?:is|to|will|should)\s+([^.?!]+)/.exec(text);
    if (ownerMatch && !NAME_STOP.has(ownerMatch[1] as string)) {
      owners.push({ owner: ownerMatch[1] as string, task: (ownerMatch[2] as string).trim(), evidence: [ev(turn)] });
    } else {
      const fromMatch = /\bfrom\s+([A-Z][a-z]{1,20})\b/.exec(text);
      if (fromMatch && /\b(need|collect|get|share)\b/i.test(text) && !NAME_STOP.has(fromMatch[1] as string)) {
        owners.push({ owner: fromMatch[1] as string, task: text, evidence: [ev(turn)] });
      }
    }

    // --- investigation-worthy facts ---
    if (FACT_KEYWORDS.test(text)) {
      facts.push({ text, evidence: [ev(turn)] });
    }
  }

  const actions: TriageAction[] = [];
  const decisions: DecisionRecord[] = [];

  // milestones -> update_milestone or clarification
  for (const [key, mval] of milestones) {
    if (mval.cancelled) continue;
    let product = key;
    if (!product) {
      if (kb.config.products.length === 1) product = kb.config.products[0]?.id ?? '';
      else if (productContext) product = productContext;
      else {
        actions.push({
          action: 'request_clarification',
          workItemId,
          question: `Which product should move to ${mval.code}?`,
          options: kb.config.products.map((p) => p.id),
          evidence: mval.evidence,
          confidence: 0.5
        });
        decisions.push(mkDecision('milestone', 'milestone:?', mval.code, 'ambiguous', mval.evidence, 0.5, now));
        continue;
      }
    }
    actions.push({
      action: 'update_milestone',
      workItemId,
      product,
      to: mval.code,
      evidence: mval.evidence,
      confidence: 0.9
    });
    decisions.push(mkDecision('milestone', `milestone:${product}`, mval.code, 'settled', mval.evidence, 0.9, now, product));
  }

  // duplicate / resolve
  if (duplicate.ofId) {
    const resolveToo = duplicate.resolve || resolve.state === 'settled';
    actions.push({
      action: 'mark_duplicate',
      workItemId,
      duplicateOfId: duplicate.ofId,
      resolve: resolveToo,
      evidence: duplicate.evidence,
      confidence: 0.9
    });
    decisions.push(
      mkDecision('duplicate', `duplicate:${workItemId}`, String(duplicate.ofId), 'settled', duplicate.evidence, 0.9, now)
    );
  } else if (resolve.state === 'settled') {
    actions.push({
      action: 'update_state',
      workItemId,
      state: 'Resolved',
      evidence: resolve.evidence,
      confidence: 0.85
    });
    decisions.push(mkDecision('state', `state:${workItemId}`, 'Resolved', 'settled', resolve.evidence, 0.85, now));
  }

  // partner case (only when explicitly confirmed)
  if (partner.state === 'confirmed') {
    const product = productContext ?? (kb.config.products.length === 1 ? kb.config.products[0]?.id ?? null : null);
    if (product) {
      actions.push({
        action: 'create_partner_case',
        workItemId,
        partner: kb.config.defaultPartner || 'PartnerCases',
        program: kb.partnerProgramFor(product) ?? `${product}-QC`,
        classifications: {},
        evidence: partner.evidence,
        confidence: 0.8
      });
    } else {
      actions.push({
        action: 'request_clarification',
        workItemId,
        question: 'Which product should the partner case be opened under?',
        options: kb.config.products.map((p) => p.id),
        evidence: partner.evidence,
        confidence: 0.5
      });
    }
  }

  // owners -> record_action
  for (const o of owners) {
    actions.push({
      action: 'record_action',
      workItemId,
      owner: o.owner,
      task: o.task,
      evidence: o.evidence,
      confidence: 0.8
    });
  }

  // investigation status (append, do not overwrite history)
  const investigationBits: string[] = [];
  for (const f of facts) investigationBits.push(f.text);
  for (const o of owners) investigationBits.push(`${o.owner}: ${o.task}`);
  for (const [key, mval] of milestones) {
    if (!mval.cancelled) investigationBits.push(`Keeping ${mval.code}${key ? ` for ${key}` : ''}`);
  }
  if (investigationBits.length > 0) {
    actions.push({
      action: 'append_investigation_status',
      workItemId,
      text: `[${fmtDate(now)}] ${dedupeJoin(investigationBits)}`,
      evidence: uniqueEvidence([
        ...facts.flatMap((f) => f.evidence),
        ...owners.flatMap((o) => o.evidence)
      ]),
      confidence: 0.75
    });
  }

  return { decisions, actions };
}
