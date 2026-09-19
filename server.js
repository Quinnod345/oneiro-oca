// The engine's own HTTP surface: the routes in api-routes.js and the panel in web/. A deployment may
// mount these inside a larger app instead (OCA_API_MODULE); a clone needs nothing but this.
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ocaRouter } from './api-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createEngineApp() {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/web', express.static(join(__dirname, 'web'), { etag: true, lastModified: true, cacheControl: true, maxAge: 0 }));
  app.get('/', (_req, res) => res.redirect('/web/engine.html'));
  app.use(ocaRouter);
  app.use((err, _req, res, _next) => { res.status(err.status || 500).json({ error: err.message }); });
  return app;
}
export const app = createEngineApp();
