import { z } from 'zod';
import { access, readFile } from 'node:fs/promises';

/**
 * Program configuration is user-editable data, not baked into source code.
 * It teaches the agent the program's products, milestones, partners and glossary.
 */

export const ProductDefSchema = z.object({
  id: z.string().min(1),
  aliases: z.array(z.string()).default([])
});

export const MilestoneDefSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([])
});

export const PartnerMappingSchema = z.object({
  product: z.string().min(1),
  partner: z.string().min(1),
  program: z.string().min(1)
});

export const GlossaryEntrySchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  aliases: z.array(z.string()).default([])
});

export const ProgramConfigSchema = z.object({
  program: z.string().min(1),
  organizationUrl: z.string().url(),
  project: z.string().min(1),
  queryName: z.string().min(1),
  queryPath: z.string().optional(),
  products: z.array(ProductDefSchema).min(1),
  milestones: z.array(MilestoneDefSchema).default([]),
  defaultPartner: z.string().default(''),
  partnerPrograms: z.array(PartnerMappingSchema).default([]),
  glossary: z.array(GlossaryEntrySchema).default([]),
  requiredFields: z.array(z.string()).default([])
});

export type ProductDef = z.infer<typeof ProductDefSchema>;
export type MilestoneDef = z.infer<typeof MilestoneDefSchema>;
export type PartnerMapping = z.infer<typeof PartnerMappingSchema>;
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;
export type ProgramConfig = z.infer<typeof ProgramConfigSchema>;

export function parseProgramConfig(data: unknown): ProgramConfig {
  return ProgramConfigSchema.parse(data);
}

/**
 * Real config files (config/ado-schema.json, config/program.<name>.json) carry
 * organization-specific values and are gitignored. The committed *.example.json
 * templates stand in when no real file is present, so a fresh clone still runs.
 */
export async function resolveConfigPath(path: string): Promise<string> {
  try {
    await access(path);
    return path;
  } catch {
    return path.replace(/\.json$/, '.example.json');
  }
}

export async function loadProgramConfig(path: string): Promise<ProgramConfig> {
  const raw = await readFile(await resolveConfigPath(path), 'utf8');
  return parseProgramConfig(JSON.parse(raw));
}
