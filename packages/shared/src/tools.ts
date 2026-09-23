import type { z } from 'zod';
import {
  type RiskLevel,
  type TriageActionName,
  UpdateMilestoneActionSchema,
  AppendInvestigationStatusActionSchema,
  UpdateFieldsActionSchema,
  UpdateOwnerActionSchema,
  UpdateSubStatusActionSchema,
  UpdateStateActionSchema,
  AddInternalCommentActionSchema,
  LinkRelatedBugActionSchema,
  MarkDuplicateActionSchema,
  CreatePartnerCaseActionSchema,
  DraftPartnerMessageActionSchema,
  SendPartnerMessageActionSchema,
  RecordActionItemActionSchema,
  RequestClarificationActionSchema,
  SpeakActionSchema,
  NoOpActionSchema,
  NextWorkItemActionSchema
} from './schemas.js';

export interface ToolDef {
  name: TriageActionName;
  title: string;
  description: string;
  risk: RiskLevel;
  /** True when the action can leave the company boundary (partner-facing). */
  egress: boolean;
  schema: z.ZodTypeAny;
}

/**
 * The catalog is the single source of truth for what the agent may do and how
 * risky each operation is. Policy and the LLM tool surface both derive from it.
 */
export const TOOL_CATALOG = {
  update_milestone: {
    name: 'update_milestone',
    title: 'Update milestone',
    description: 'Set the release/milestone for a specific product on a work item.',
    risk: 'medium',
    egress: false,
    schema: UpdateMilestoneActionSchema
  },
  append_investigation_status: {
    name: 'append_investigation_status',
    title: 'Append investigation status',
    description: 'Append a concise, dated engineering status entry, preserving history.',
    risk: 'medium',
    egress: false,
    schema: AppendInvestigationStatusActionSchema
  },
  update_fields: {
    name: 'update_fields',
    title: 'Update fields',
    description: 'Patch one or more scalar work-item fields.',
    risk: 'medium',
    egress: false,
    schema: UpdateFieldsActionSchema
  },
  update_owner: {
    name: 'update_owner',
    title: 'Update owner',
    description: 'Change the Assigned To / owner of a work item.',
    risk: 'medium',
    egress: false,
    schema: UpdateOwnerActionSchema
  },
  update_sub_status: {
    name: 'update_sub_status',
    title: 'Update sub-status',
    description: 'Change the triage sub-status (e.g. Investigating, Waiting on partner).',
    risk: 'medium',
    egress: false,
    schema: UpdateSubStatusActionSchema
  },
  update_state: {
    name: 'update_state',
    title: 'Update state',
    description: 'Change the workflow state (e.g. Active, Resolved, Closed).',
    risk: 'high',
    egress: false,
    schema: UpdateStateActionSchema
  },
  add_internal_comment: {
    name: 'add_internal_comment',
    title: 'Add internal comment',
    description: 'Add an internal discussion comment to the work item.',
    risk: 'medium',
    egress: false,
    schema: AddInternalCommentActionSchema
  },
  link_related_bug: {
    name: 'link_related_bug',
    title: 'Link related bug',
    description: 'Create a Related link to another work item.',
    risk: 'medium',
    egress: false,
    schema: LinkRelatedBugActionSchema
  },
  mark_duplicate: {
    name: 'mark_duplicate',
    title: 'Mark duplicate',
    description: 'Create a Duplicate/Duplicate-Of relationship and optionally resolve.',
    risk: 'high',
    egress: false,
    schema: MarkDuplicateActionSchema
  },
  create_partner_case: {
    name: 'create_partner_case',
    title: 'Create partner case',
    description: 'Configure partner + program + classifications to open a partner (e.g. PartnerCo) case.',
    risk: 'high',
    egress: false,
    schema: CreatePartnerCaseActionSchema
  },
  draft_partner_message: {
    name: 'draft_partner_message',
    title: 'Draft partner message',
    description: 'Draft (do not send) a partner-facing message for review.',
    risk: 'low',
    egress: false,
    schema: DraftPartnerMessageActionSchema
  },
  send_partner_message: {
    name: 'send_partner_message',
    title: 'Send partner message',
    description: 'Write to Partner Discussion — leaves the company boundary.',
    risk: 'high',
    egress: true,
    schema: SendPartnerMessageActionSchema
  },
  record_action: {
    name: 'record_action',
    title: 'Record action item',
    description: 'Record an owner + task in meeting memory (no ADO write by itself).',
    risk: 'low',
    egress: false,
    schema: RecordActionItemActionSchema
  },
  request_clarification: {
    name: 'request_clarification',
    title: 'Request clarification',
    description: 'Ask the meeting a disambiguating question before acting.',
    risk: 'low',
    egress: false,
    schema: RequestClarificationActionSchema
  },
  speak: {
    name: 'speak',
    title: 'Speak to meeting',
    description: 'Say a brief conversational response aloud.',
    risk: 'low',
    egress: false,
    schema: SpeakActionSchema
  },
  no_op: {
    name: 'no_op',
    title: 'No operation',
    description: 'Explicitly do nothing (e.g. discussion was non-actionable or reversed).',
    risk: 'low',
    egress: false,
    schema: NoOpActionSchema
  },
  next_work_item: {
    name: 'next_work_item',
    title: 'Next work item',
    description: 'Advance the triage queue to the next work item.',
    risk: 'low',
    egress: false,
    schema: NextWorkItemActionSchema
  }
} satisfies Record<TriageActionName, ToolDef>;

export function getToolDef(name: TriageActionName): ToolDef {
  return TOOL_CATALOG[name];
}

export function allToolDefs(): ToolDef[] {
  return Object.values(TOOL_CATALOG);
}
