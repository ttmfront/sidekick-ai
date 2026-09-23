import 'dotenv/config';
import { buildServer } from './server.js';
import { loadBackendConfig } from './config.js';

const config = loadBackendConfig();
const app = await buildServer({ config });

try {
  const address = await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`agenttriager listening on ${address} (provider=${config.aiProvider})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
