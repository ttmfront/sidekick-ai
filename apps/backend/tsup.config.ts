import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  bundle: true,
  clean: true,
  sourcemap: true,
  // Bundle the workspace packages (they resolve to TS source); keep third-party
  // deps external and install them on the host via package.json.
  noExternal: [/@triager\//]
});
