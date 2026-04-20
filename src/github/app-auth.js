import { createSign } from 'node:crypto';

const GITHUB_API_ORIGIN = 'https://api.github.com';

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePemValue(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/\\n/g, '\n');
}

function encodeBase64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');

  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildGitHubApiHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'crowdship',
    'x-github-api-version': '2026-03-10',
  };
}

async function readGitHubJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body.message === 'string' && body.message.trim()
        ? body.message.trim()
        : `GitHub API request failed with status ${response.status}.`;
    const error = new Error(message);
    error.name = 'GitHubApiError';
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

export function isGitHubApiError(error) {
  return Boolean(error && typeof error === 'object' && error.name === 'GitHubApiError');
}

export function getGitHubAppConfig(env = process.env) {
  const appId = normalizeOptionalString(env.GITHUB_APP_ID);
  const privateKey = normalizePemValue(env.GITHUB_APP_PRIVATE_KEY);
  const clientId = normalizeOptionalString(env.GITHUB_APP_CLIENT_ID);
  const clientSecret = normalizeOptionalString(env.GITHUB_APP_CLIENT_SECRET);
  const webhookSecret = normalizeOptionalString(env.GITHUB_APP_WEBHOOK_SECRET);

  if (!appId || !privateKey) {
    return null;
  }

  return {
    appId,
    privateKey,
    clientId,
    clientSecret,
    webhookSecret,
  };
}

export function createGitHubAppJwt(
  { appId, privateKey },
  { nowMs = Date.now() } = {},
) {
  const issuedAt = Math.floor(nowMs / 1000) - 60;
  const expiresAt = issuedAt + 10 * 60;
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iat: issuedAt,
    exp: expiresAt,
    iss: appId,
  };
  const encodedHeader = encodeBase64Url(header);
  const encodedPayload = encodeBase64Url(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${encodeBase64Url(signer.sign(privateKey))}`;
}

export async function getGitHubAppMetadata(
  { config, fetchImpl = fetch, nowMs = Date.now() },
) {
  const token = createGitHubAppJwt(config, { nowMs });
  const response = await fetchImpl(`${GITHUB_API_ORIGIN}/app`, {
    headers: buildGitHubApiHeaders(token),
    method: 'GET',
  });
  const body = await readGitHubJsonResponse(response);

  return {
    id: body?.id ?? null,
    slug: normalizeOptionalString(body?.slug),
    name: normalizeOptionalString(body?.name),
    htmlUrl: normalizeOptionalString(body?.html_url),
    ownerLogin: normalizeOptionalString(body?.owner?.login),
    raw: body,
  };
}

export async function getGitHubAppInstallationForRepository(
  { repositoryFullName, config, fetchImpl = fetch, nowMs = Date.now() },
) {
  const normalizedRepositoryFullName = normalizeOptionalString(repositoryFullName);

  if (!normalizedRepositoryFullName) {
    throw new Error('repositoryFullName is required to resolve a GitHub App installation.');
  }

  const token = createGitHubAppJwt(config, { nowMs });
  const response = await fetchImpl(`${GITHUB_API_ORIGIN}/repos/${normalizedRepositoryFullName}/installation`, {
    headers: buildGitHubApiHeaders(token),
    method: 'GET',
  });
  const body = await readGitHubJsonResponse(response);

  return {
    id: body?.id ?? null,
    accountLogin: normalizeOptionalString(body?.account?.login),
    repositorySelection: normalizeOptionalString(body?.repository_selection),
    raw: body,
  };
}

export async function createGitHubInstallationAccessToken(
  { installationId, config, fetchImpl = fetch, nowMs = Date.now() },
) {
  const normalizedInstallationId =
    typeof installationId === 'number' && Number.isInteger(installationId) && installationId > 0
      ? installationId
      : Number.parseInt(String(installationId ?? ''), 10);

  if (!normalizedInstallationId) {
    throw new Error('installationId is required to create a GitHub installation token.');
  }

  const token = createGitHubAppJwt(config, { nowMs });
  const response = await fetchImpl(
    `${GITHUB_API_ORIGIN}/app/installations/${normalizedInstallationId}/access_tokens`,
    {
      headers: buildGitHubApiHeaders(token),
      method: 'POST',
    },
  );
  const body = await readGitHubJsonResponse(response);

  return {
    token: normalizeOptionalString(body?.token),
    expiresAt: normalizeOptionalString(body?.expires_at),
    permissions: body?.permissions ?? {},
    repositories: Array.isArray(body?.repositories) ? body.repositories : [],
    raw: body,
  };
}

export async function getGitHubRepositoryAccessToken(
  { repositoryFullName, config, fetchImpl = fetch, nowMs = Date.now() },
) {
  const installation = await getGitHubAppInstallationForRepository({
    repositoryFullName,
    config,
    fetchImpl,
    nowMs,
  });

  if (!installation.id) {
    throw new Error(`GitHub App installation not found for repository ${repositoryFullName}.`);
  }

  const accessToken = await createGitHubInstallationAccessToken({
    installationId: installation.id,
    config,
    fetchImpl,
    nowMs,
  });

  if (!accessToken.token) {
    throw new Error(`GitHub App installation token was empty for repository ${repositoryFullName}.`);
  }

  return {
    installationId: installation.id,
    repositoryFullName: normalizeOptionalString(repositoryFullName),
    token: accessToken.token,
    expiresAt: accessToken.expiresAt,
    permissions: accessToken.permissions,
    repositorySelection: installation.repositorySelection,
  };
}
