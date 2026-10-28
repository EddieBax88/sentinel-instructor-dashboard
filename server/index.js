import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { confirmProposal, isAgentConfigured, runAgent } from './agent.js';
import analyticsRouter from './analytics.js';
import { captureSandboxOrder, createSandboxOrder, isPaypalConfigured } from './paypal.js';
import { authenticateSupabaseUser, getBearerToken, isSupabaseConfigured, listPaypalOrdersForUser, publicSupabaseConfiguration } from './supabase.js';
import webhookRouter from './webhook.js';
import { dashboardFromOrders } from './seatUnlock.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const clientBuildDirectory = path.join(projectDirectory, 'dist');
const app = express();


app.disable('x-powered-by');
app.use(express.json({
  verify: (request, _response, buffer) => {
    if (request.originalUrl.startsWith('/api/paypal/webhook')) request.rawBody = Buffer.from(buffer);
  },
}));
app.get('/api/dashboard', (_request, response) => {
  const paymentAvailable = isPaypalConfigured() && isSupabaseConfigured();
  response.json({ paymentAvailable, agentAvailable: paymentAvailable && isAgentConfigured() });
});

// The ledger is per instructor: the user ID comes only from the verified access token.
app.get('/api/ledger', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    response.json(dashboardFromOrders(await listPaypalOrdersForUser(user.id)));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.use('/api/analytics', analyticsRouter);

app.get('/api/supabase-config', (_request, response) => {
  try {
    response.json(publicSupabaseConfiguration());
  } catch (error) {
    response.status(error.statusCode || 503).json({ error: error.message });
  }
});

app.post('/api/paypal/orders', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    const order = await createSandboxOrder({ studentName: request.body?.studentName, userId: user.id });
    response.status(201).json(order);
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post('/api/paypal/orders/:orderId/capture', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    response.json(await captureSandboxOrder(request.params.orderId, user.id));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post('/api/agent/chat', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    response.json(await runAgent({ userId: user.id, messages: request.body?.messages }));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post('/api/agent/proposals/:proposalId/confirm', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    response.status(201).json(await confirmProposal({ proposalId: request.params.proposalId, userId: user.id }));
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.use('/api/paypal/webhook', webhookRouter);
app.get('/api/health', (_request, response) => response.json({ status: 'ok', environment: 'sandbox-only' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientBuildDirectory));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
    response.sendFile(path.join(clientBuildDirectory, 'index.html'));
  });
} else {
  const vite = await createViteServer({
    configFile: path.join(projectDirectory, 'vite.config.js'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Sentinel dashboard listening on http://localhost:${port}`);
});