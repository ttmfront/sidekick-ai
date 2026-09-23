import type { Evidence } from './schemas.js';
import type { PolicyOutcome } from './policy.js';

/** Classification of a single meeting utterance (an utterance may carry several). */
export type UtteranceClass =
  | 'fact'
  | 'hypothesis'
  | 'question'
  | 'decision'
  | 'action_item'
  | 'owner'
  | 'blocker'
  | 'milestone'
  | 'state_change'
  | 'partner_request'
  | 'duplicate'
  | 'non_actionable';

export type ParticipantRole = 'pm' | 'engineer' | 'partner' | 'agent' | 'unknown';

export interface TranscriptTurn {
  turnId: string;
  speaker?: string;
  role?: ParticipantRole;
  text: string;
  /** epoch milliseconds */
  ts: number;
  source?: 'mic' | 'system';
}

export interface ClassifiedUtterance {
  turn: TranscriptTurn;
  classes: UtteranceClass[];
}

export type DecisionType =
  | 'milestone'
  | 'state'
  | 'owner'
  | 'sub_status'
  | 'duplicate'
  | 'partner_case'
  | 'partner_message'
  | 'investigation'
  | 'other';

export type DecisionStatus = 'open' | 'settled' | 'cancelled' | 'ambiguous';

/**
 * A single evolving decision. Contradictory statements update the same record
 * (keyed by `key`) instead of spawning multiple writes.
 */
export interface DecisionRecord {
  id: string;
  type: DecisionType;
  /** Dedup key, e.g. "milestone:PROGRAM_B" or "state:5000498". */
  key: string;
  /** Settled value; null means an explicit "none / cancelled". */
  value: string | null;
  status: DecisionStatus;
  product?: string;
  evidence: Evidence[];
  confidence: number;
  updatedAt: number;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  targetId?: number;
  attributes?: Record<string, unknown>;
}

export interface WorkItemSnapshot {
  id: number;
  rev: number;
  workItemType: string;
  title: string;
  state: string;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
}

export interface AuditEntry {
  id: string;
  ts: number;
  workItemId?: number;
  action: string;
  outcome: PolicyOutcome | 'executed' | 'failed';
  before?: unknown;
  after?: unknown;
  evidence?: Evidence[];
  confidence?: number;
  approvedBy?: string;
  adoRevisionBefore?: number;
  adoRevisionAfter?: number;
  error?: string;
}

export type MeetingSessionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'paused'
  | 'offline'
  | 'ended';

export interface MeetingSession {
  id: string;
  program: string;
  startedAt: number;
  state: MeetingSessionState;
  currentWorkItemId?: number;
  participants: string[];
}

export interface ContextReference {
  id: string;
  title?: string;
  url?: string;
}

export interface MeetingContext {
  currentWorkItem?: ContextReference;
  currentComponent?: string;
  currentPlatform?: string;
  currentRelease?: string;
  currentInvestigation?: string;
  mentionedPeople: string[];
  mentionedBugs: ContextReference[];
  mentionedPRs: ContextReference[];
  decisions: string[];
  openQuestions: string[];
  blockers: string[];
  actionItems: { owner?: string; task: string }[];
  updatedAt: number;
}

export interface ToolSource {
  kind: 'work_item' | 'comment' | 'history' | 'pull_request' | 'build' | 'partner_case';
  id: string;
  title?: string;
  url?: string;
}

export type ToolResult<T> =
  | { status: 'found'; data: T; sources: ToolSource[] }
  | { status: 'empty'; data: T; sources: ToolSource[]; message: string }
  | { status: 'error'; error: string; retryable: boolean };
