import { describe, expect, it } from 'vitest';
import type { WorkItemSnapshot } from '@triager/shared';
import { DraftOnlyPartnerProvider } from './partner';

const workItem: WorkItemSnapshot = {
  id: 12345,
  rev: 4,
  workItemType: 'Bug',
  title: 'Resume failure after Secure Boot initialization',
  state: 'Active',
  fields: {
    'System.Description': '<p>Blank screen after resume.</p>',
    'System.AreaPath': 'Surface\\Firmware',
    'Microsoft.VSTS.TCM.ReproSteps': '<p>Sleep, then resume.</p>',
    'Microsoft.VSTS.Common.Severity': '2 - High'
  }
};

describe('DraftOnlyPartnerProvider', () => {
  it('never claims an external case was created', async () => {
    const result = await new DraftOnlyPartnerProvider().createCaseDraft(workItem, 'PartnerCo');
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.data.mode).toBe('draft-only');
      expect(result.data.notice).toContain('no external case has been created');
      expect(result.data.component).toBe('Surface\\Firmware');
    }
  });

  it('distinguishes missing connector data from a verified case match', async () => {
    const result = await new DraftOnlyPartnerProvider().searchCases(workItem, 'PartnerCo');
    expect(result).toMatchObject({ status: 'empty', data: [] });
  });
});