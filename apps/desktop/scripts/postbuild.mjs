import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Copy the renderer HTML and program/schema config next to the built bundles
// so the packaged app is self-contained (loaded relative to __dirname at runtime).
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..'); // apps/desktop
const repoRoot = join(appRoot, '..', '..');

mkdirSync(join(appRoot, 'dist/renderer'), { recursive: true });
mkdirSync(join(appRoot, 'dist/config'), { recursive: true });

copyFileSync(join(appRoot, 'src/renderer/index.html'), join(appRoot, 'dist/renderer/index.html'));

// Real config (gitignored, org-specific) wins; the committed *.example.json
// template is copied instead when no real file is present.
function copyConfig(name) {
  const real = join(repoRoot, 'config', `${name}.json`);
  const example = join(repoRoot, 'config', `${name}.example.json`);
  copyFileSync(existsSync(real) ? real : example, join(appRoot, 'dist/config', `${name}.json`));
}

copyConfig('program');
copyConfig('ado-schema');

// Bundle the generated project-overview PDF (if present) so it can be attached by default.
const defaultDoc = join(repoRoot, 'docs/Agent-Triager-Project-Overview.pdf');
if (existsSync(defaultDoc)) {
  mkdirSync(join(appRoot, 'dist/docs'), { recursive: true });
  copyFileSync(defaultDoc, join(appRoot, 'dist/docs/Agent-Triager-Project-Overview.pdf'));
}

console.log('postbuild: copied index.html + program/schema config into dist/');
