import type { TriageAction, WorkItemSnapshot } from '@triager/shared';
import type { AdoClient, AdoSchema, FieldValue } from '@triager/ado';

export interface DiffLine {
  field: string;
  before: string;
  after: string;
}

export interface ActionPreview {
  supported: boolean;
  summary: string;
  diff: DiffLine[];
  warning?: string;
}

export interface ExecResult {
  ok: boolean;
  summary: string;
  revisionBefore?: number;
  revisionAfter?: number;
  error?: string;
}

function stripHtml(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

function identityName(v: unknown): string {
  if (v && typeof v === 'object' && 'displayName' in v) {
    return String((v as { displayName: unknown }).displayName);
  }
  return v ? String(v) : '';
}

/**
 * Turns a validated TriageAction into a real Azure DevOps write. Custom-field
 * actions resolve their reference name from the discovered schema and are marked
 * unsupported (never guessed) until discovery has run. Every write re-reads the
 * item for a fresh revision so patches use optimistic concurrency.
 */
export class ActionExecutor {
  constructor(
    private readonly client: AdoClient,
    private readonly getSchema: () => AdoSchema | null
  ) {}

  private ref(key: string): string | null {
    return this.getSchema()?.fields[key]?.referenceName ?? null;
  }

  private tag = 'added by electron';

  setTag(tag: string): void {
    if (tag.trim()) this.tag = tag.trim();
  }

  /** Field change that adds the attribution tag, or empty if already present. */
  private tagChange(fields: Record<string, unknown>): Record<string, FieldValue> {
    const cur = String(fields['System.Tags'] ?? '');
    const has = cur
      .split(';')
      .map((s) => s.trim().toLowerCase())
      .includes(this.tag.toLowerCase());
    return has ? {} : { 'System.Tags': cur ? `${cur}; ${this.tag}` : this.tag };
  }

  private async ensureTag(workItemId: number): Promise<void> {
    const fresh = await this.client.getWorkItem(workItemId, 'fields');
    const change = this.tagChange(fresh.fields);
    if (Object.keys(change).length) await this.client.updateFields(workItemId, change, fresh.rev);
  }

  preview(action: TriageAction, wi: WorkItemSnapshot): ActionPreview {
    const f = wi.fields;
    switch (action.action) {
      case 'add_internal_comment':
        return { supported: true, summary: 'Add internal discussion comment', diff: [{ field: 'Discussion', before: '', after: action.text }] };
      case 'append_investigation_status': {
        const r = this.ref('investigationStatus');
        if (!r) return { supported: false, summary: 'Append investigation status', diff: [], warning: 'Investigation Status field not mapped — run Discover schema first.' };
        const before = stripHtml(f[r]);
        return { supported: true, summary: 'Append investigation status (preserves history)', diff: [{ field: 'Investigation Status', before, after: (before ? `${before}\n` : '') + action.text }] };
      }
      case 'update_state': {
        const diff: DiffLine[] = [{ field: 'State', before: wi.state, after: action.state }];
        if (action.reason) diff.push({ field: 'Reason', before: String(f['System.Reason'] ?? ''), after: action.reason });
        return { supported: true, summary: `Set state to ${action.state}`, diff };
      }
      case 'update_owner':
        return { supported: true, summary: `Assign to ${action.owner}`, diff: [{ field: 'Assigned To', before: identityName(f['System.AssignedTo']), after: action.owner }], warning: 'ADO needs a resolvable identity (email/UPN).' };
      case 'update_milestone': {
        const r = this.ref('milestone');
        if (!r) return { supported: false, summary: `Set ${action.product} milestone to ${action.to}`, diff: [], warning: 'Milestone field not mapped — run Discover schema first.' };
        return { supported: true, summary: `Set milestone to ${action.to} (${action.product})`, diff: [{ field: 'Milestone', before: String(f[r] ?? ''), after: action.to }], warning: 'Verify value against allowed values (e.g. "SW - VR").' };
      }
      case 'update_sub_status': {
        const r = this.ref('subStatus');
        if (!r) return { supported: false, summary: `Set sub-status to ${action.subStatus}`, diff: [], warning: 'Sub Status field not mapped — run Discover schema first.' };
        return { supported: true, summary: `Set sub-status to ${action.subStatus}`, diff: [{ field: 'Sub Status', before: String(f[r] ?? ''), after: action.subStatus }] };
      }
      case 'update_fields': {
        const diff = Object.entries(action.changes).map(([k, v]) => ({ field: k, before: String(f[k] ?? ''), after: String(v) }));
        return { supported: true, summary: 'Update fields', diff };
      }
      case 'mark_duplicate': {
        const diff: DiffLine[] = [{ field: 'Relation', before: '', after: `Duplicate Of #${action.duplicateOfId}` }];
        if (action.resolve) diff.push({ field: 'State', before: wi.state, after: 'Resolved' });
        return { supported: true, summary: `Mark duplicate of #${action.duplicateOfId}${action.resolve ? ' and resolve' : ''}`, diff };
      }
      case 'link_related_bug':
        return { supported: true, summary: `Link related #${action.targetId}`, diff: [{ field: 'Relation', before: '', after: `Related #${action.targetId}` }] };
      case 'send_partner_message': {
        const r = this.ref('partnerDiscussion');
        if (!r) return { supported: false, summary: 'Send partner message', diff: [], warning: 'Partner Discussion field not mapped — run Discover schema first.' };
        return { supported: true, summary: 'Post to Partner Discussion (EXTERNAL)', diff: [{ field: 'Partner Discussion', before: '', after: action.message }], warning: 'This message can leave the company boundary.' };
      }
      case 'create_partner_case':
        return { supported: false, summary: 'Create partner (PartnerCo) case', diff: [], warning: 'Partner-case creation is a guided workflow — not yet enabled in the write engine.' };
      case 'draft_partner_message':
        return { supported: false, summary: 'Draft partner message', diff: [{ field: '(draft)', before: '', after: action.message }], warning: 'Draft only — review before sending.' };
      case 'record_action':
        return { supported: false, summary: `Note: ${action.owner} — ${action.task}`, diff: [], warning: 'Meeting note only (no ADO write).' };
      case 'request_clarification':
        return { supported: false, summary: `Clarify: ${action.question}`, diff: [], warning: 'Needs an answer before acting.' };
      case 'speak':
        return { supported: false, summary: `Say: ${action.text}`, diff: [] };
      case 'no_op':
        return { supported: false, summary: 'No action', diff: [] };
      case 'next_work_item':
        return { supported: false, summary: 'Advance to next work item', diff: [] };
      default:
        return { supported: false, summary: 'Unknown action', diff: [] };
    }
  }

  async execute(action: TriageAction, workItemId: number): Promise<ExecResult> {
    const wi = await this.client.getWorkItem(workItemId, 'all');
    const rev = wi.rev;
    const tag = this.tagChange(wi.fields);
    try {
      switch (action.action) {
        case 'add_internal_comment': {
          await this.client.addComment(workItemId, action.text);
          await this.ensureTag(workItemId);
          return { ok: true, summary: 'Comment added', revisionBefore: rev };
        }
        case 'append_investigation_status': {
          const r = this.ref('investigationStatus');
          if (!r) return { ok: false, summary: '', error: 'Investigation Status field not mapped.' };
          const appended = String(wi.fields[r] ?? '') + `<div>${escHtml(action.text)}</div>`;
          const res = await this.client.updateFields(workItemId, { [r]: appended, ...tag }, rev);
          return { ok: true, summary: 'Investigation status appended', revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'update_state': {
          const changes: Record<string, FieldValue> = { 'System.State': action.state, ...tag };
          if (action.reason) changes['System.Reason'] = action.reason;
          const res = await this.client.updateFields(workItemId, changes, rev);
          return { ok: true, summary: action.reason ? `State set to ${action.state} (${action.reason})` : `State set to ${action.state}`, revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'update_owner': {
          const res = await this.client.updateFields(workItemId, { 'System.AssignedTo': action.owner, ...tag }, rev);
          return { ok: true, summary: `Assigned to ${action.owner}`, revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'update_milestone': {
          const r = this.ref('milestone');
          if (!r) return { ok: false, summary: '', error: 'Milestone field not mapped.' };
          const res = await this.client.updateFields(workItemId, { [r]: action.to, ...tag }, rev);
          return { ok: true, summary: `Milestone set to ${action.to}`, revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'update_sub_status': {
          const r = this.ref('subStatus');
          if (!r) return { ok: false, summary: '', error: 'Sub Status field not mapped.' };
          const res = await this.client.updateFields(workItemId, { [r]: action.subStatus, ...tag }, rev);
          return { ok: true, summary: `Sub-status set to ${action.subStatus}`, revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'update_fields': {
          const res = await this.client.updateFields(
            workItemId,
            { ...(action.changes as Record<string, FieldValue>), ...tag },
            rev
          );
          return { ok: true, summary: 'Fields updated', revisionBefore: rev, revisionAfter: res.rev };
        }
        case 'mark_duplicate': {
          await this.client.markDuplicateOf(workItemId, action.duplicateOfId);
          if (action.resolve) {
            const fresh = await this.client.getWorkItem(workItemId, 'fields');
            await this.client.updateFields(workItemId, { 'System.State': 'Resolved', ...this.tagChange(fresh.fields) }, fresh.rev);
          } else {
            await this.ensureTag(workItemId);
          }
          return { ok: true, summary: `Marked duplicate of #${action.duplicateOfId}`, revisionBefore: rev };
        }
        case 'link_related_bug': {
          await this.client.linkRelated(workItemId, action.targetId);
          await this.ensureTag(workItemId);
          return { ok: true, summary: `Linked related #${action.targetId}`, revisionBefore: rev };
        }
        case 'send_partner_message': {
          const r = this.ref('partnerDiscussion');
          if (!r) return { ok: false, summary: '', error: 'Partner Discussion field not mapped.' };
          const appended = String(wi.fields[r] ?? '') + `<div>${escHtml(action.message)}</div>`;
          const res = await this.client.updateFields(workItemId, { [r]: appended, ...tag }, rev);
          return { ok: true, summary: 'Partner message posted', revisionBefore: rev, revisionAfter: res.rev };
        }
        default:
          return { ok: false, summary: '', error: `Action "${action.action}" is not executable by the write engine.` };
      }
    } catch (e) {
      return { ok: false, summary: '', error: e instanceof Error ? e.message : String(e) };
    }
  }
}
