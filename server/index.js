import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './app.js';

// Local server: the API from server/app.js plus the client, built (`npm start`) or through Vite's
// dev middleware (`npm run dev`). On Vercel, api/index.js serves the API and dist/ is static.
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(currentDirectory, '..');
const clientBuildDirectory = path.join(projectDirectory, 'dist');

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientBuildDirectory));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) return next();
    response.sendFile(path.join(clientBuildDirectory, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
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
