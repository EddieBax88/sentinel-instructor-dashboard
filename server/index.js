import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { captureSandboxOrder, createSandboxOrder, isPaypalConfigured } from './paypal.js';
import webhookRouter from './webhook.js';
import { getDashboardState } from './seatUnlock.js';

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
  response.json({ ...getDashboardState(), paymentAvailable: isPaypalConfigured() });
});

app.post('/api/paypal/orders', async (request, response) => {
  try {
    const order = await createSandboxOrder({ studentName: request.body?.studentName });
    response.status(201).json(order);
  } catch (error) {
    response.status(error.statusCode || 502).json({ error: error.message });
  }
});

app.post('/api/paypal/orders/:orderId/capture', async (request, response) => {
  try {
    response.json(await captureSandboxOrder(request.params.orderId));
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