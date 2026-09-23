import type { ToolResult, ToolSource, WorkItemSnapshot } from '@triager/shared';

export interface PartnerCaseSummary {
  id: string;
  partner: string;
  title: string;
  status?: string;
  lastResponseAt?: string;
  url?: string;
}

export interface PartnerCaseDraft {
  mode: 'draft-only';
  partner: string;
  title: string;
  relatedWorkItemId: number;
  issueSummary: string;
  platform?: string;
  build?: string;
  component?: string;
  reproSteps?: string;
  investigation?: string;
  severity?: string;
  expectedBehavior?: string;
  actualBehavior?: string;
  questions: string[];
  notice: string;
}

export interface PartnerProvider {
  searchCases(workItem: WorkItemSnapshot, partner?: string): Promise<ToolResult<PartnerCaseSummary[]>>;
  createCaseDraft(workItem: WorkItemSnapshot, partner: string): Promise<ToolResult<PartnerCaseDraft>>;
}

function text(value: unknown): string {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export class DraftOnlyPartnerProvider implements PartnerProvider {
  constructor(private readonly partnerDiscussionField?: string) {}

  async searchCases(workItem: WorkItemSnapshot, partner = 'partner'): Promise<ToolResult<PartnerCaseSummary[]>> {
    const discussion = this.partnerDiscussionField ? text(workItem.fields[this.partnerDiscussionField]) : '';
    if (!discussion) {
      return {
        status: 'empty', data: [], sources: [],
        message: `No ${partner} case connector is configured and no partner discussion was found on this work item.`
      };
    }
    const source: ToolSource = { kind: 'work_item', id: String(workItem.id), title: workItem.title };
    return {
      status: 'empty', data: [], sources: [source],
      message: `Partner discussion exists on work item ${workItem.id}, but a case ID could not be verified without a partner connector.`
    };
  }

  async createCaseDraft(workItem: WorkItemSnapshot, partner: string): Promise<ToolResult<PartnerCaseDraft>> {
    const fields = workItem.fields;
    const draft: PartnerCaseDraft = {
      mode: 'draft-only',
      partner,
      title: workItem.title,
      relatedWorkItemId: workItem.id,
      issueSummary: text(fields['System.Description']) || workItem.title,
      platform: text(fields['System.Tags']),
      build: text(fields['Microsoft.VSTS.Build.FoundIn']),
      component: text(fields['System.AreaPath']),
      reproSteps: text(fields['Microsoft.VSTS.TCM.ReproSteps']),
      investigation: text(fields['Microsoft.VSTS.TCM.SystemInfo']),
      severity: text(fields['Microsoft.VSTS.Common.Severity']),
      expectedBehavior: text(fields['Microsoft.VSTS.TCM.ReproSteps']),
      actualBehavior: text(fields['System.Description']),
      questions: [],
      notice: 'Draft only. No partner connector is configured, so no external case has been created.'
    };
    return {
      status: 'found', data: draft,
      sources: [{ kind: 'work_item', id: String(workItem.id), title: workItem.title }]
    };
  }
}