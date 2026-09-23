import type { ProgramKnowledge } from '@triager/knowledge';
import { analyzeTranscript, type PlanInput, type AnalysisResult } from './analyze.js';

/**
 * Contract for a reasoning backend. The deterministic MockReasoningProvider runs
 * offline (and drives tests); a production Azure OpenAI provider will implement
 * the same interface. Neither writes to ADO — they only propose validated actions.
 */
export interface ReasoningProvider {
  readonly name: string;
  plan(input: PlanInput): Promise<AnalysisResult>;
}

export class MockReasoningProvider implements ReasoningProvider {
  readonly name = 'mock';
  constructor(private readonly kb: ProgramKnowledge) {}

  async plan(input: PlanInput): Promise<AnalysisResult> {
    return analyzeTranscript(input, this.kb);
  }
}
