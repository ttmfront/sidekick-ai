import type { RiskLevel, TriageAction, TriageActionName } from './schemas.js';
import { TOOL_CATALOG } from './tools.js';

/** How the deterministic layer should handle a proposed action. */
export type PolicyOutcome = 'auto' | 'confirm' | 'clarify' | 'reject';

export interface PolicyConfig {
  /** Below this confidence, actionable writes are downgraded to clarification. */
  minConfidence: number;
  autoExecuteLowRisk: boolean;
  autoExecuteMediumRisk: boolean;
  mediumRiskAutoThreshold: number;
  /** When false, any partner-facing egress requires confirmation. */
  allowPartnerAutoSend: boolean;
}

/** Conservative MVP defaults: nothing risky executes without a human. */
export const DEFAULT_POLICY: PolicyConfig = {
  minConfidence: 0.55,
  autoExecuteLowRisk: true,
  autoExecuteMediumRisk: false,
  mediumRiskAutoThreshold: 0.9,
  allowPartnerAutoSend: false
};

export interface PolicyResult {
  outcome: PolicyOutcome;
  risk: RiskLevel;
  reason: string;
}

function confidenceOf(action: TriageAction): number {
  const c = (action as { confidence?: unknown }).confidence;
  return typeof c === 'number' ? c : 1;
}

/**
 * Pure, deterministic mapping from a proposed action + config to a handling decision.
 * This is the safety gate between "the model wants to" and "we actually do it".
 */
export function evaluatePolicy(
  action: TriageAction,
  config: PolicyConfig = DEFAULT_POLICY
): PolicyResult {
  const tool = TOOL_CATALOG[action.action as TriageActionName];
  if (!tool) {
    return { outcome: 'reject', risk: 'high', reason: `Unknown action: ${String(action.action)}` };
  }

  if (action.action === 'request_clarification') {
    return { outcome: 'clarify', risk: tool.risk, reason: 'Explicit clarification requested' };
  }
  if (action.action === 'no_op') {
    return { outcome: 'auto', risk: tool.risk, reason: 'No operation' };
  }

  const conf = confidenceOf(action);
  const isActionableWrite = tool.risk !== 'low';
  if (isActionableWrite && conf < config.minConfidence) {
    return {
      outcome: 'clarify',
      risk: tool.risk,
      reason: `Confidence ${conf.toFixed(2)} below threshold ${config.minConfidence}`
    };
  }

  if (tool.egress && !config.allowPartnerAutoSend) {
    return { outcome: 'confirm', risk: tool.risk, reason: 'Partner-facing egress requires confirmation' };
  }

  switch (tool.risk) {
    case 'low':
      return {
        outcome: config.autoExecuteLowRisk ? 'auto' : 'confirm',
        risk: 'low',
        reason: 'Low-risk action'
      };
    case 'medium':
      if (config.autoExecuteMediumRisk && conf >= config.mediumRiskAutoThreshold) {
        return { outcome: 'auto', risk: 'medium', reason: 'Medium-risk auto-approved by policy' };
      }
      return { outcome: 'confirm', risk: 'medium', reason: 'Medium-risk requires confirmation' };
    case 'high':
      return { outcome: 'confirm', risk: 'high', reason: 'High-risk requires explicit confirmation' };
    default:
      return { outcome: 'reject', risk: 'high', reason: 'Unclassified risk' };
  }
}
