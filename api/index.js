import app from '../server/app.js';

// Vercel Function entry: the whole API as one function. vercel.json rewrites /api/<route> to
// /api?__route=<route>; Vercel's rewrite docs show a rewritten request reaching the function at
// the destination path, with path parameters as query parameters. The Express routes in
// server/app.js match full /api/... paths, so the original path is rebuilt here first. A request
// that already has its /api/... path is left as it is (only the helper parameter is removed).
export function restoreApiUrl(rawUrl) {
  const url = new URL(rawUrl, 'http://localhost');
  const route = url.searchParams.get('__route');
  url.searchParams.delete('__route');
  const pathname = url.pathname.startsWith('/api/') || route === null
    ? url.pathname
    : `/api/${route.replace(/^\/+/, '')}`;
  return `${pathname}${url.search}`;
}

export default function handler(request, response) {
  request.url = restoreApiUrl(request.url);
  return app(request, response);
}
