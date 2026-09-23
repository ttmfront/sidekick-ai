import { z } from 'zod';

/**
 * Structured triage actions. The reasoning layer proposes these; deterministic
 * code validates and (after policy approval) executes them against Azure DevOps.
 * The realtime/voice model never bypasses these schemas.
 */

export const RiskLevelSchema = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/** A pointer back to the meeting turn(s) that justify an action. */
export const EvidenceSchema = z.object({
  turnId: z.string().min(1),
  speaker: z.string().optional(),
  quote: z.string().min(1)
});
export type Evidence = z.infer<typeof EvidenceSchema>;

const workItemId = z.number().int().positive();
const confidence = z.number().min(0).max(1);
const evidence = z.array(EvidenceSchema);

export const UpdateMilestoneActionSchema = z.object({
  action: z.literal('update_milestone'),
  workItemId,
  product: z.string().min(1),
  from: z.string().optional(),
  to: z.string().min(1),
  evidence,
  confidence
});

export const AppendInvestigationStatusActionSchema = z.object({
  action: z.literal('append_investigation_status'),
  workItemId,
  text: z.string().min(1),
  evidence,
  confidence
});

export const UpdateFieldsActionSchema = z.object({
  action: z.literal('update_fields'),
  workItemId,
  changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  evidence,
  confidence
});

export const UpdateOwnerActionSchema = z.object({
  action: z.literal('update_owner'),
  workItemId,
  owner: z.string().min(1),
  evidence,
  confidence
});

export const UpdateSubStatusActionSchema = z.object({
  action: z.literal('update_sub_status'),
  workItemId,
  subStatus: z.string().min(1),
  evidence,
  confidence
});

export const UpdateStateActionSchema = z.object({
  action: z.literal('update_state'),
  workItemId,
  state: z.string().min(1),
  reason: z.string().optional(),
  evidence,
  confidence
});

export const AddInternalCommentActionSchema = z.object({
  action: z.literal('add_internal_comment'),
  workItemId,
  text: z.string().min(1),
  evidence,
  confidence
});

export const LinkRelatedBugActionSchema = z.object({
  action: z.literal('link_related_bug'),
  workItemId,
  targetId: z.number().int().positive(),
  evidence,
  confidence
});

export const MarkDuplicateActionSchema = z.object({
  action: z.literal('mark_duplicate'),
  workItemId,
  duplicateOfId: z.number().int().positive(),
  resolve: z.boolean().default(true),
  evidence,
  confidence
});

export const PartnerClassificationsSchema = z.object({
  area1: z.string().optional(),
  area2: z.string().optional(),
  area3: z.string().optional()
});
export type PartnerClassifications = z.infer<typeof PartnerClassificationsSchema>;

export const CreatePartnerCaseActionSchema = z.object({
  action: z.literal('create_partner_case'),
  workItemId,
  partner: z.string().min(1),
  program: z.string().min(1),
  classifications: PartnerClassificationsSchema.default({}),
  evidence,
  confidence
});

export const DraftPartnerMessageActionSchema = z.object({
  action: z.literal('draft_partner_message'),
  workItemId,
  message: z.string().min(1),
  evidence,
  confidence
});

export const SendPartnerMessageActionSchema = z.object({
  action: z.literal('send_partner_message'),
  workItemId,
  message: z.string().min(1),
  evidence,
  confidence
});

export const RecordActionItemActionSchema = z.object({
  action: z.literal('record_action'),
  workItemId,
  owner: z.string().min(1),
  task: z.string().min(1),
  evidence,
  confidence
});

export const RequestClarificationActionSchema = z.object({
  action: z.literal('request_clarification'),
  workItemId: workItemId.optional(),
  question: z.string().min(1),
  options: z.array(z.string()).optional(),
  evidence,
  confidence
});

export const SpeakActionSchema = z.object({
  action: z.literal('speak'),
  text: z.string().min(1),
  confidence: confidence.default(1)
});

export const NoOpActionSchema = z.object({
  action: z.literal('no_op'),
  reason: z.string().min(1)
});

export const NextWorkItemActionSchema = z.object({
  action: z.literal('next_work_item'),
  workItemId: workItemId.optional()
});

export const TriageActionSchema = z.discriminatedUnion('action', [
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
]);
export type TriageAction = z.infer<typeof TriageActionSchema>;
export type TriageActionName = TriageAction['action'];

export const TriageActionArraySchema = z.array(TriageActionSchema);

export function parseTriageAction(input: unknown) {
  return TriageActionSchema.safeParse(input);
}

export function parseTriageActions(input: unknown) {
  return TriageActionArraySchema.safeParse(input);
}
