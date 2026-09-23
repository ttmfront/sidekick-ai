import { describe, expect, it, vi } from 'vitest';
import type { AdoClient } from '@triager/ado';
import type { WorkItemSnapshot } from '@triager/shared';
import { AdoIntelligenceService, parseBuildArtifact, parsePullRequestArtifact } from './intelligence';

const source: WorkItemSnapshot = {
  id: 12345, rev: 2, workItemType: 'Bug', title: 'Resume failure after Secure Boot initialization', state: 'Active',
  fields: { 'System.AreaPath': 'Surface\\Firmware', 'System.Description': 'Blank screen on resume', 'System.Tags': 'AMD; resume' }, relations: []
};

describe('AdoIntelligenceService', () => {
  it('parses ADO pull request artifact links', () => {
    expect(parsePullRequestArtifact('vstfs:///Git/PullRequestId/project%2Frepository%2F7821')).toEqual({ repositoryId: 'repository', pullRequestId: 7821 });
  });

  it('ranks related bugs using multiple evidence signals', async () => {
    const client = {
      getWorkItem: vi.fn().mockResolvedValue(source),
      runWiql: vi.fn().mockResolvedValue([11872, 10192]),
      getWorkItemsBatch: vi.fn().mockResolvedValue([
        { ...source, id: 11872, title: 'Resume failure after firmware initialization', state: 'Resolved', fields: { ...source.fields, 'System.Title': 'Resume failure after firmware initialization' } },
        { ...source, id: 10192, title: 'Unrelated camera issue', state: 'Active', fields: { 'System.AreaPath': 'Surface\\Camera', 'System.Description': 'Camera timeout' } }
      ])
    } as unknown as AdoClient;
    const service = new AdoIntelligenceService(client, 'https://dev.azure.com/org', 'YourProject');
    const result = await service.searchRelated(12345);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.data.map((item) => item.id)).toEqual([11872]);
      expect(result.sources[0].url).toContain('/_workitems/edit/11872');
    }
  });

  it('distinguishes an empty search from an ADO failure', async () => {
    const emptyClient = {
      getWorkItem: vi.fn().mockResolvedValue(source), runWiql: vi.fn().mockResolvedValue([]), getWorkItemsBatch: vi.fn().mockResolvedValue([])
    } as unknown as AdoClient;
    const failedClient = { getWorkItem: vi.fn().mockRejectedValue(new Error('ADO unavailable')) } as unknown as AdoClient;
    expect((await new AdoIntelligenceService(emptyClient, 'https://dev.azure.com/org', 'YourProject').searchRelated(12345)).status).toBe('empty');
    const failed = await new AdoIntelligenceService(failedClient, 'https://dev.azure.com/org', 'YourProject').searchRelated(12345);
    expect(failed).toMatchObject({ status: 'error', error: 'ADO unavailable' });
  });

  it('tracks blockers and action items without changing work-item focus', () => {
    const service = new AdoIntelligenceService({} as AdoClient, 'https://dev.azure.com/org', 'YourProject');
    service.observeTurn({ turnId: '1', text: 'We are blocked awaiting PartnerCo on AMD.', ts: 1 });
    const context = service.observeTurn({ turnId: '2', text: 'Sarah will compare the previous firmware implementation.', ts: 2 });
    expect(context.currentPlatform).toBe('AMD');
    expect(context.blockers).toEqual(['We are blocked awaiting PartnerCo on AMD.']);
    expect(context.actionItems).toEqual([{ owner: 'Sarah', task: 'compare the previous firmware implementation' }]);
    expect(context.currentWorkItem).toBeUndefined();
  });

  it('parses linked build artifact IDs without guessing other links', () => {
    expect(parseBuildArtifact('vstfs:///Build/Build/261001234')).toBe(261001234);
    expect(parseBuildArtifact('https://example.test/build/1')).toBeNull();
  });
});