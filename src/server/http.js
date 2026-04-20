import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { API_ROUTE_DEFINITIONS } from '../shared/contracts.js';
import { createConfiguredContributionPersistenceAdapter } from './persistence.js';
import { createRouteHandlers } from './routes.js';

function jsonResponse(res, status, body, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  };

  res.writeHead(status, headers);
  res.end(body == null ? '' : JSON.stringify(body));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');

      if (!rawBody) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function splitPath(pathname) {
  return pathname.split('/').filter(Boolean);
}

function matchRoute(method, pathname) {
  const requestSegments = splitPath(pathname);

  for (const definition of API_ROUTE_DEFINITIONS) {
    if (definition.method !== method) {
      continue;
    }

    const routeSegments = splitPath(definition.path);
    if (routeSegments.length !== requestSegments.length) {
      continue;
    }

    const params = {};
    let matched = true;

    for (let index = 0; index < routeSegments.length; index += 1) {
      const routeSegment = routeSegments[index];
      const requestSegment = requestSegments[index];

      if (routeSegment.startsWith(':')) {
        params[routeSegment.slice(1)] = decodeURIComponent(requestSegment);
        continue;
      }

      if (routeSegment !== requestSegment) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return {
        definition,
        params,
      };
    }
  }

  return null;
}

function createRequestHandler(options = {}) {
  const routeHandlers = createRouteHandlers({
    ...options,
    database: options.database ?? createConfiguredContributionPersistenceAdapter(),
  });

  return async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'OPTIONS') {
      jsonResponse(response, 204, null);
      return;
    }

    const matchedRoute = matchRoute(request.method ?? 'GET', requestUrl.pathname);

    if (!matchedRoute) {
      jsonResponse(response, 404, {
        error: 'route_not_found',
        method: request.method ?? 'GET',
        path: requestUrl.pathname,
      });
      return;
    }

    let body = null;
    const expectsJsonBody = matchedRoute.definition.bodyMode !== 'stream';

    if (expectsJsonBody && (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH')) {
      try {
        body = await readRequestBody(request);
      } catch {
        jsonResponse(response, 400, {
          error: 'invalid_json',
          message: 'Request body must be valid JSON.',
        });
        return;
      }
    }

    const handler = routeHandlers[matchedRoute.definition.handler];
    const result = await handler({
      params: matchedRoute.params,
      body,
      query: Object.fromEntries(requestUrl.searchParams.entries()),
      request,
    });

    jsonResponse(response, result.status, result.body);
  };
}

export function createApiServer(options = {}) {
  return http.createServer(createRequestHandler(options));
}

export function startApiServer(options = {}) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || options.port || 3000;
  const host = process.env.HOST || options.host || '127.0.0.1';
  const server = createApiServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        host,
        port: resolvedPort,
        url: `http://${host}:${resolvedPort}`,
      });
    });
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  const { url } = await startApiServer();
  process.stdout.write(`crowdship api listening on ${url}\n`);
}
