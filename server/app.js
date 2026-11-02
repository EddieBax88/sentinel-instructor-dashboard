// The Express app: every /api route. No static files, no Vite, no listener, so the same app runs
// locally (server/index.js) and as one Vercel Function (api/index.js).
import express from 'express';
import { confirmProposal, isAgentConfigured, runAgent } from './agent.js';
import { isAnthropicConfigured } from './anthropic.js';
import analyticsRouter from './analytics.js';
import studioAiRouter from './studioAi.js';
import { captureSandboxOrder, createSandboxOrder, isPaypalConfigured } from './paypal.js';
import { authenticateSupabaseUser, getBearerToken, isSupabaseConfigured, listPaypalOrdersForUser, listWebhookEventsForUser, publicSupabaseConfiguration } from './supabase.js';
import webhookRouter, { publicWebhookEvent } from './webhook.js';
import { dashboardFromOrders } from './seatUnlock.js';

const app = express();

app.disable('x-powered-by');
// Mounted before the app-wide JSON parser: Studio's agent requests need a larger body limit.
app.use('/api/studio-ai', studioAiRouter);
app.use(express.json({
  verify: (request, _response, buffer) => {
    if (request.originalUrl.startsWith('/api/paypal/webhook')) request.rawBody = Buffer.from(buffer);
  },
}));
app.get('/api/dashboard', (_request, response) => {
  const paymentAvailable = isPaypalConfigured() && isSupabaseConfigured();
  response.json({
    paymentAvailable,
    agentAvailable: paymentAvailable && isAgentConfigured(),
    analyticsAssistantAvailable: isSupabaseConfigured() && isAnthropicConfigured(),
  });
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

// Verified PayPal webhook events for the signed-in instructor's own orders (event drawer).
app.get('/api/paypal/events', async (request, response) => {
  try {
    const user = await authenticateSupabaseUser(getBearerToken(request.get('authorization')));
    const rows = await listWebhookEventsForUser(user.id);
    response.set('Cache-Control', 'no-store');
    response.json({ events: rows.map(publicWebhookEvent) });
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.use('/api/paypal/webhook', webhookRouter);
// Vercel sets VERCEL_GIT_COMMIT_SHA on every deploy, so the live health check names the commit it runs.
app.get('/api/health', (_request, response) => response.json({ status: 'ok', environment: 'sandbox-only', commit: process.env.VERCEL_GIT_COMMIT_SHA || undefined }));

export default app;
