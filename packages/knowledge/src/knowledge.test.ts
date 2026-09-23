import { describe, it, expect } from 'vitest';
import { ProgramKnowledge, parseProgramConfig } from './index.js';

const config = parseProgramConfig({
  program: 'PROGRAM_A',
  organizationUrl: 'https://dev.azure.com/your-org',
  project: 'YourProject',
  queryName: 'TEAM_SPRINT_QUERY',
  products: [
    { id: 'PROGRAM_A', aliases: ['701', 'SAE'] },
    { id: 'PROGRAM_B', aliases: ['702', 'ROT'] }
  ],
  milestones: [
    { code: 'VR', name: 'Validation Ready', aliases: ['SW-VR', 'SW VR'] },
    { code: 'CC', name: 'Code Complete' },
    { code: 'QCC', name: 'Quality Control Check', aliases: ['SW-QCC'] }
  ],
  defaultPartner: 'PartnerCases',
  partnerPrograms: [
    { product: 'PROGRAM_A', partner: 'PartnerCases', program: 'PROGRAM_A-PC' },
    { product: 'PROGRAM_B', partner: 'PartnerCases', program: 'PROGRAM_B-PC' }
  ],
  glossary: [
    { term: 'BSP', definition: 'Board Support Package' },
    { term: 'VR', definition: 'Validation Ready' }
  ]
});

const kb = new ProgramKnowledge(config);

describe('ProgramKnowledge', () => {
  it('resolves a product from an alias', () => {
    expect(kb.resolveProduct('keep 702 for VR')).toBe('PROGRAM_B');
    expect(kb.resolveProduct('this affects SAE')).toBe('PROGRAM_A');
  });

  it('does not falsely match aliases inside larger words', () => {
    // "701" only as a token; "7010" should not resolve.
    expect(kb.resolveProduct('sprint 7010 notes')).toBeNull();
  });

  it('finds multiple products and flags ambiguity', () => {
    const found = kb.findProductsInText('this affects both 702 and 701');
    expect(found).toContain('PROGRAM_B');
    expect(found).toContain('PROGRAM_A');
    expect(kb.isProductAmbiguous('this affects both 702 and 701')).toBe(true);
    expect(kb.isProductAmbiguous('only 702 here')).toBe(false);
  });

  it('resolves milestones by code, name and alias', () => {
    expect(kb.resolveMilestone('this still blocks VR')).toBe('VR');
    expect(kb.resolveMilestone('move it to Quality Control Check')).toBe('QCC');
    expect(kb.resolveMilestone('set SW-QCC')).toBe('QCC');
  });

  it('maps a product to its partner program', () => {
    expect(kb.partnerProgramFor('PROGRAM_A')).toBe('PROGRAM_A-PC');
    expect(kb.partnerProgramFor('PROGRAM_B')).toBe('PROGRAM_B-PC');
    expect(kb.partnerProgramFor('unknown')).toBeNull();
  });

  it('looks up glossary terms case-insensitively', () => {
    expect(kb.glossaryLookup('bsp')?.definition).toBe('Board Support Package');
    expect(kb.glossaryLookup('nope')).toBeNull();
  });
});
