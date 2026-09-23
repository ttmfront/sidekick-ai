import { describe, it, expect } from 'vitest';
import {
  matchFriendlyToField,
  reconcileSchema,
  undiscoveredFields,
  type AdoFieldMeta,
  type AdoSchema
} from './schema-discovery.js';

const fields: AdoFieldMeta[] = [
  { referenceName: 'System.Title', name: 'Title', type: 'string' },
  { referenceName: 'Custom.Milestone', name: 'Milestone', type: 'string' },
  { referenceName: 'Custom.PartnerBugId', name: 'Partner Bug ID', type: 'string' },
  { referenceName: 'Custom.InvestigationStatus', name: 'Investigation Status', type: 'html' }
];

describe('matchFriendlyToField', () => {
  it('returns confidence 1 on an exact normalized match', () => {
    const m = matchFriendlyToField('Partner Bug ID', fields);
    expect(m?.field.referenceName).toBe('Custom.PartnerBugId');
    expect(m?.confidence).toBe(1);
  });

  it('returns null when nothing plausible matches', () => {
    expect(matchFriendlyToField('Totally Unrelated', fields)).toBeNull();
  });
});

describe('reconcileSchema', () => {
  const schema: AdoSchema = {
    organizationUrl: 'https://dev.azure.com/your-org',
    project: 'YourProject',
    fields: {
      milestone: { friendlyName: 'Milestone', referenceName: null, type: null, discovered: false },
      investigationStatus: {
        friendlyName: 'Investigation Status',
        referenceName: null,
        type: null,
        discovered: false
      },
      mystery: { friendlyName: 'Zzz Not A Field', referenceName: null, type: null, discovered: false }
    }
  };

  it('fills reference names for confidently matched custom fields', () => {
    const out = reconcileSchema(schema, fields);
    expect(out.fields.milestone.referenceName).toBe('Custom.Milestone');
    expect(out.fields.milestone.discovered).toBe(true);
    expect(out.fields.investigationStatus.referenceName).toBe('Custom.InvestigationStatus');
  });

  it('leaves unmatched fields undiscovered for manual mapping', () => {
    const out = reconcileSchema(schema, fields);
    expect(out.fields.mystery.discovered).toBe(false);
    expect(undiscoveredFields(out)).toContain('mystery');
  });
});
