import Fastify from 'fastify';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import { supportedModels } from './pricing.js';

const app = Fastify();

app.get('/health', async () => ({
  status: 'ok',
  models: supportedModels(),
  provider_chain_configured: {
    groq: config.groqApiKey !== null,
    mock: true,
  },
  failure_injection_enabled: config.allowFailureInjection,
}));

app.get('/ready', async (_req, reply) => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ready' };
  } catch (err) {
    return reply.status(503).send({ status: 'not_ready', error: (err as Error).message });
  }
});

registerChatRoutes(app);
registerAdminRoutes(app);


async function main(): Promise<void> {
  await migrate();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    { models: supportedModels(), chain: config.providerChain },
    'llm-gateway listening',
  );
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
