import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerChatRoutes } from './routes/chat.js';
import { supportedModels, getModelPricingInfo } from './pricing.js';

const app = Fastify();

app.get('/health', async () => ({
  status: 'ok',
  models: supportedModels(),
  model_pricing: getModelPricingInfo(),
  provider_chain_configured: {
    groq: config.groqApiKey !== null,
    openrouter: config.openrouterApiKey !== null,
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

app.get('/dashboard', async (_req, reply) => {
  try {
    const htmlPath = path.join(process.cwd(), 'public', 'admin.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    return reply.type('text/html').send(html);
  } catch (err) {
    return reply.status(500).send({ error: 'Dashboard UI not found' });
  }
});

app.get('/chat', async (_req, reply) => {
  try {
    const htmlPath = path.join(process.cwd(), 'public', 'chat.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    return reply.type('text/html').send(html);
  } catch (err) {
    return reply.status(500).send({ error: 'Chat UI not found' });
  }
});


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
