import type { GlossaryEntry, ProgramConfig } from './config.js';

/** Whole-token, case-insensitive match so "cc" does not match inside "success". */
function tokenMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i');
  return re.test(haystack);
}

/**
 * Semantic resolver over program terminology. The reasoning layer uses this to
 * ground spoken shorthand ("702", "keep VR") into concrete products/milestones,
 * and to detect when a statement is ambiguous across products.
 */
export class ProgramKnowledge {
  constructor(public readonly config: ProgramConfig) {}

  resolveProduct(text: string): string | null {
    for (const p of this.config.products) {
      if (tokenMatch(text, p.id) || p.aliases.some((a) => tokenMatch(text, a))) {
        return p.id;
      }
    }
    return null;
  }

  findProductsInText(text: string): string[] {
    const found = new Set<string>();
    for (const p of this.config.products) {
      if (tokenMatch(text, p.id) || p.aliases.some((a) => tokenMatch(text, a))) {
        found.add(p.id);
      }
    }
    return [...found];
  }

  resolveMilestone(term: string): string | null {
    for (const m of this.config.milestones) {
      if (
        tokenMatch(term, m.code) ||
        tokenMatch(term, m.name) ||
        m.aliases.some((a) => tokenMatch(term, a))
      ) {
        return m.code;
      }
    }
    return null;
  }

  milestoneName(code: string): string | null {
    const m = this.config.milestones.find((x) => x.code.toLowerCase() === code.toLowerCase());
    return m ? m.name : null;
  }

  partnerProgramFor(product: string): string | null {
    const m = this.config.partnerPrograms.find(
      (x) => x.product.toLowerCase() === product.toLowerCase()
    );
    return m ? m.program : null;
  }

  glossaryLookup(term: string): GlossaryEntry | null {
    const t = term.toLowerCase();
    return (
      this.config.glossary.find(
        (g) => g.term.toLowerCase() === t || g.aliases.some((a) => a.toLowerCase() === t)
      ) ?? null
    );
  }

  /** True when a statement references more than one product and needs disambiguation. */
  isProductAmbiguous(text: string): boolean {
    return this.findProductsInText(text).length > 1;
  }
}
