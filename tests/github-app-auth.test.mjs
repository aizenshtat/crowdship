import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  createGitHubAppJwt,
  createGitHubInstallationAccessToken,
  getGitHubAppMetadata,
  getGitHubAppConfig,
  getGitHubAppInstallationForRepository,
  getGitHubRepositoryAccessToken,
  verifyGitHubWebhookSignature,
} from '../src/github/app-auth.js';

function decodeJwtPayload(token) {
  const [, encodedPayload] = token.split('.');
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
}

test('github app config reads multiline private keys from env style values', () => {
  const config = getGitHubAppConfig({
    GITHUB_APP_ID: '12345',
    GITHUB_APP_PRIVATE_KEY: 'test-line-1\\ntest-line-2\\ntest-line-3',
    GITHUB_APP_CLIENT_ID: 'Iv1.abc',
    GITHUB_APP_CLIENT_SECRET: 'secret',
    GITHUB_APP_WEBHOOK_SECRET: 'hook-secret',
  });

  assert.deepEqual(config, {
    appId: '12345',
    privateKey: 'test-line-1\ntest-line-2\ntest-line-3',
    clientId: 'Iv1.abc',
    clientSecret: 'secret',
    webhookSecret: 'hook-secret',
  });
});

test('github app jwt contains the app id issuer and bounded timestamps', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
      format: 'pem',
      type: 'pkcs8',
    },
    publicKeyEncoding: {
      format: 'pem',
      type: 'spki',
    },
  });

  const token = createGitHubAppJwt(
    {
      appId: '98765',
      privateKey,
    },
    {
      nowMs: Date.UTC(2026, 3, 20, 12, 0, 0),
    },
  );

  const payload = decodeJwtPayload(token);

  assert.equal(payload.iss, '98765');
  assert.equal(payload.exp - payload.iat, 600);
  assert.ok(token.split('.').length === 3);
});

test('github app installation lookup reads repository installation metadata', async () => {
  const responses = [];

  const installation = await getGitHubAppInstallationForRepository({
    repositoryFullName: 'customer/orbital-ops',
    config: {
      appId: '12345',
      privateKey: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
          format: 'pem',
          type: 'pkcs8',
        },
        publicKeyEncoding: {
          format: 'pem',
          type: 'spki',
        },
      }).privateKey,
    },
    async fetchImpl(url, options) {
      responses.push({ url, options });
      return new Response(
        JSON.stringify({
          id: 42,
          repository_selection: 'selected',
          account: {
            login: 'customer',
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
    nowMs: Date.UTC(2026, 3, 20, 12, 0, 0),
  });

  assert.equal(installation.id, 42);
  assert.equal(installation.accountLogin, 'customer');
  assert.equal(installation.repositorySelection, 'selected');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].url, 'https://api.github.com/repos/customer/orbital-ops/installation');
  assert.equal(responses[0].options.method, 'GET');
  assert.match(responses[0].options.headers.authorization, /^Bearer /);
});

test('github app metadata lookup returns the app slug and owner', async () => {
  const metadata = await getGitHubAppMetadata({
    config: {
      appId: '12345',
      privateKey: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
          format: 'pem',
          type: 'pkcs8',
        },
        publicKeyEncoding: {
          format: 'pem',
          type: 'spki',
        },
      }).privateKey,
    },
    async fetchImpl(url, options) {
      assert.equal(url, 'https://api.github.com/app');
      assert.equal(options.method, 'GET');
      return new Response(
        JSON.stringify({
          id: 55,
          slug: 'aizenshtat-crowdship',
          name: 'Aizenshtat CrowdShip',
          html_url: 'https://github.com/apps/aizenshtat-crowdship',
          owner: {
            login: 'aizenshtat',
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
    nowMs: Date.UTC(2026, 3, 20, 12, 0, 0),
  });

  assert.deepEqual(metadata, {
    id: 55,
    slug: 'aizenshtat-crowdship',
    name: 'Aizenshtat CrowdShip',
    htmlUrl: 'https://github.com/apps/aizenshtat-crowdship',
    ownerLogin: 'aizenshtat',
    raw: {
      id: 55,
      slug: 'aizenshtat-crowdship',
      name: 'Aizenshtat CrowdShip',
      html_url: 'https://github.com/apps/aizenshtat-crowdship',
      owner: {
        login: 'aizenshtat',
      },
    },
  });
});

test('github app installation token exchange returns the repo token', async () => {
  const response = await createGitHubInstallationAccessToken({
    installationId: 42,
    config: {
      appId: '12345',
      privateKey: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
          format: 'pem',
          type: 'pkcs8',
        },
        publicKeyEncoding: {
          format: 'pem',
          type: 'spki',
        },
      }).privateKey,
    },
    async fetchImpl(url, options) {
      assert.equal(url, 'https://api.github.com/app/installations/42/access_tokens');
      assert.equal(options.method, 'POST');
      return new Response(
        JSON.stringify({
          token: 'ghs_example',
          expires_at: '2026-04-20T13:00:00Z',
          permissions: {
            contents: 'write',
            pull_requests: 'write',
          },
        }),
        {
          status: 201,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
    nowMs: Date.UTC(2026, 3, 20, 12, 0, 0),
  });

  assert.equal(response.token, 'ghs_example');
  assert.equal(response.expiresAt, '2026-04-20T13:00:00Z');
  assert.deepEqual(response.permissions, {
    contents: 'write',
    pull_requests: 'write',
  });
});

test('github webhook signature verification matches GitHub sha256 signatures', () => {
  const payload = JSON.stringify({
    zen: 'Ship it.',
  });
  const signatureHeader = `sha256=${createHmac('sha256', 'hook-secret').update(payload).digest('hex')}`;

  assert.equal(
    verifyGitHubWebhookSignature({
      payload,
      secret: 'hook-secret',
      signatureHeader,
    }),
    true,
  );
  assert.equal(
    verifyGitHubWebhookSignature({
      payload,
      secret: 'wrong-secret',
      signatureHeader,
    }),
    false,
  );
});

test('github app repository access token resolves installation and token from repository name', async () => {
  const requests = [];

  const access = await getGitHubRepositoryAccessToken({
    repositoryFullName: 'customer/orbital-ops',
    config: {
      appId: '12345',
      privateKey: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: {
          format: 'pem',
          type: 'pkcs8',
        },
        publicKeyEncoding: {
          format: 'pem',
          type: 'spki',
        },
      }).privateKey,
    },
    async fetchImpl(url, options) {
      requests.push({ url, options });

      if (url.endsWith('/repos/customer/orbital-ops/installation')) {
        return new Response(
          JSON.stringify({
            id: 99,
            repository_selection: 'selected',
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }

      if (url.endsWith('/app/installations/99/access_tokens')) {
        return new Response(
          JSON.stringify({
            token: 'ghs_repo',
            expires_at: '2026-04-20T13:00:00Z',
            permissions: {
              contents: 'write',
            },
          }),
          {
            status: 201,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }

      throw new Error(`Unexpected GitHub API request: ${url}`);
    },
    nowMs: Date.UTC(2026, 3, 20, 12, 0, 0),
  });

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      'https://api.github.com/repos/customer/orbital-ops/installation',
      'https://api.github.com/app/installations/99/access_tokens',
    ],
  );
  assert.equal(access.installationId, 99);
  assert.equal(access.token, 'ghs_repo');
  assert.equal(access.repositoryFullName, 'customer/orbital-ops');
});
