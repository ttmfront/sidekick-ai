import { defineConfig } from 'tsup';

// Three separate bundles: Electron main (CJS/node), preload (CJS/node),
// and renderer (IIFE/browser). Workspace @triager/* packages are bundled;
// electron and @azure/identity stay external (resolved at runtime).
export default defineConfig([
  {
    entry: { index: 'src/main/index.ts' },
    outDir: 'dist/main',
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    clean: true,
    sourcemap: true,
    external: ['electron', '@azure/identity', 'pdf-parse'],
    noExternal: [/@triager\//]
  },
  {
    entry: { index: 'src/preload/index.ts' },
    outDir: 'dist/preload',
    format: ['cjs'],
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    external: ['electron']
  },
  {
    entry: { index: 'src/renderer/main.ts' },
    outDir: 'dist/renderer',
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    outExtension() {
      return { js: '.js' };
    }
  }
]);
