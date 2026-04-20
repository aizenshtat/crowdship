import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const DEFAULT_CONTEXT_FILES = Object.freeze([
  'package.json',
  'src/App.tsx',
  'src/data.ts',
  'src/main.tsx',
  'src/styles.css',
  'tests/contracts.test.mjs',
  'tests/widget-integration.test.mjs',
]);

const DEFAULT_ALLOWED_PREFIXES = Object.freeze([
  'package.json',
  'src/',
  'tests/',
  'public/',
]);

export const IMPLEMENTATION_PROFILES = Object.freeze({
  orbital_ops_reference: Object.freeze({
    id: 'orbital_ops_reference',
    appLabel: 'Orbital Ops reference app',
    runtimeLabel: 'React 19 + TypeScript + Vite',
    allowedPrefixes: DEFAULT_ALLOWED_PREFIXES,
    contextFiles: DEFAULT_CONTEXT_FILES,
    styleGuard:
      'Preserve Crowdship widget integration and the Orbital Ops visual language unless the approved spec requires otherwise.',
  }),
  react_vite_app: Object.freeze({
    id: 'react_vite_app',
    appLabel: 'customer-owned React, TypeScript, and Vite app',
    runtimeLabel: 'React + TypeScript + Vite',
    allowedPrefixes: DEFAULT_ALLOWED_PREFIXES,
    contextFiles: DEFAULT_CONTEXT_FILES,
    styleGuard: 'Preserve the host app design system and existing Crowdship integration unless the approved spec requires otherwise.',
  }),
});

export const SUPPORTED_IMPLEMENTATION_PROFILES = Object.freeze(Object.keys(IMPLEMENTATION_PROFILES));

const LEGACY_PROJECT_IMPLEMENTATION_PROFILES = Object.freeze({
  example: 'orbital_ops_reference',
});

export class ImplementationServiceError extends Error {
  constructor(message, { code = 'implementation_generation_failed', statusCode = 502 } = {}) {
    super(message);
    this.name = 'ImplementationServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (raw || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function cleanText(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getSupportedProfileList() {
  return SUPPORTED_IMPLEMENTATION_PROFILES.join(', ');
}

export function resolveImplementationProfile(detail, runtimeConfig = null) {
  const projectSlug = cleanText(detail?.contribution?.projectSlug);
  const configuredProfileId = cleanText(runtimeConfig?.implementationProfile);
  const profileId = configuredProfileId || LEGACY_PROJECT_IMPLEMENTATION_PROFILES[projectSlug] || '';
  const profile = IMPLEMENTATION_PROFILES[profileId] ?? null;

  if (profile) {
    return profile;
  }

  throw new ImplementationServiceError(
    configuredProfileId
      ? `Unsupported implementation profile "${configuredProfileId}". Supported profiles: ${getSupportedProfileList()}.`
      : `Project "${projectSlug || 'unknown'}" requires runtimeConfig.implementationProfile. Supported profiles: ${getSupportedProfileList()}.`,
    {
      code: 'unsupported_implementation_profile',
      statusCode: 500,
    },
  );
}

function getLatestSpec(detail) {
  return asArray(detail?.specVersions)
    .slice()
    .sort((left, right) => (right?.versionNumber ?? 0) - (left?.versionNumber ?? 0))[0] ?? null;
}

function sanitizeEditPath(worktreePath, rawPath, { allowedPrefixes = DEFAULT_ALLOWED_PREFIXES } = {}) {
  const normalized = cleanText(rawPath).replace(/\\/g, '/');
  if (!normalized) {
    throw new ImplementationServiceError('Implementation edit path is missing.', {
      code: 'invalid_edit_path',
    });
  }

  if (normalized.startsWith('/') || normalized.includes('\0')) {
    throw new ImplementationServiceError(`Implementation edit path is invalid: ${normalized}`, {
      code: 'invalid_edit_path',
    });
  }

  const isAllowed = allowedPrefixes.some((prefix) =>
    prefix.endsWith('/') ? normalized.startsWith(prefix) : normalized === prefix,
  );

  if (!isAllowed) {
    throw new ImplementationServiceError(`Implementation edit path is outside the allowed repo surface: ${normalized}`, {
      code: 'invalid_edit_path',
    });
  }

  const absolutePath = resolve(worktreePath, normalized);
  const relativePath = relative(worktreePath, absolutePath).replace(/\\/g, '/');

  if (!relativePath || relativePath.startsWith('..')) {
    throw new ImplementationServiceError(`Implementation edit path escapes the worktree: ${normalized}`, {
      code: 'invalid_edit_path',
    });
  }

  return {
    path: relativePath,
    absolutePath,
  };
}

export function collectImplementationContext(worktreePath, profile = IMPLEMENTATION_PROFILES.orbital_ops_reference) {
  return asArray(profile?.contextFiles)
    .filter((path) => existsSync(resolve(worktreePath, path)))
    .map((path) => ({
      path,
      content: readFileSync(resolve(worktreePath, path), 'utf8'),
    }));
}

export function collectExampleImplementationContext(worktreePath) {
  return collectImplementationContext(worktreePath, IMPLEMENTATION_PROFILES.orbital_ops_reference);
}

export function sanitizeImplementationEdits(worktreePath, files, options = {}) {
  const edits = [];
  const seen = new Set();

  for (const entry of asArray(files)) {
    const pathInfo = sanitizeEditPath(worktreePath, entry?.path, options);
    const content = typeof entry?.content === 'string' ? entry.content : '';

    if (!content) {
      throw new ImplementationServiceError(`Implementation edit for ${pathInfo.path} is missing file content.`, {
        code: 'invalid_edit_content',
      });
    }

    if (seen.has(pathInfo.path)) {
      continue;
    }

    seen.add(pathInfo.path);
    edits.push({
      path: pathInfo.path,
      absolutePath: pathInfo.absolutePath,
      content,
      reason: cleanText(entry?.reason, 'Approved spec implementation update'),
    });
  }

  if (edits.length === 0) {
    throw new ImplementationServiceError('OpenAI returned no file edits for implementation.', {
      code: 'no_edits_returned',
    });
  }

  return edits;
}

export function writeImplementationEdits(worktreePath, files, options = {}) {
  const edits = sanitizeImplementationEdits(worktreePath, files, options);

  for (const edit of edits) {
    mkdirSync(dirname(edit.absolutePath), { recursive: true });
    writeFileSync(edit.absolutePath, edit.content, 'utf8');
  }

  return edits.map((edit) => ({ path: edit.path, reason: edit.reason }));
}

function buildImplementationMessages(mode, payload, profile) {
  const system = [
    `You are Crowdship implementation worker for the ${profile.appLabel}.`,
    `You are editing a real ${profile.runtimeLabel} repository.`,
    'Implement only the approved scope, using the existing design and code patterns.',
    'Prefer changing existing files over creating new ones.',
    'Do not output markdown, explanations, diffs, or placeholders.',
    'Return full replacement file contents for changed files only.',
    'The result must contain real product code changes, not docs-only changes.',
    'Keep the change narrow, testable, and likely to pass npm test and npm run build.',
    profile.styleGuard,
    'Update tests when the visible behavior or integration contract changes.',
  ].join(' ');

  const instructionsByMode = {
    initial:
      'Implement the approved spec now using the provided repository files. Touch as few files as possible while making the feature real.',
    repair:
      'The previous implementation failed local verification. Fix the repository by updating the necessary files so the approved spec still holds and the errors are resolved.',
  };

  return [
    {
      role: 'system',
      content: system,
    },
    {
      role: 'user',
      content: JSON.stringify({
        mode,
        instruction: instructionsByMode[mode],
        implementationRequest: payload,
      }),
    },
  ];
}

function getEditToolDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_repo_edits',
      description: 'Return the repository file updates needed to implement the approved spec.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
          },
          files: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                reason: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
              additionalProperties: false,
            },
          },
        },
        required: ['summary', 'files'],
        additionalProperties: false,
      },
    },
  };
}

function parseToolArguments(payload, toolName) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = choice?.message ?? null;

  if (message?.refusal) {
    throw new ImplementationServiceError(`OpenAI refused the implementation request: ${message.refusal}`, {
      code: 'openai_refused',
      statusCode: 502,
    });
  }

  const toolCall = Array.isArray(message?.tool_calls)
    ? message.tool_calls.find((entry) => entry?.function?.name === toolName)
    : null;

  if (!toolCall?.function?.arguments) {
    throw new ImplementationServiceError('OpenAI did not return the expected implementation edit payload.', {
      code: 'openai_invalid_response',
      statusCode: 502,
    });
  }

  return JSON.parse(toolCall.function.arguments);
}

function buildImplementationPayload({ detail, worktreePath, verificationFailure = null, runtimeConfig = null }) {
  const profile = resolveImplementationProfile(detail, runtimeConfig);
  const latestSpec = getLatestSpec(detail);
  const repoFiles = collectImplementationContext(worktreePath, profile);

  return {
    project: detail.contribution.projectSlug,
    contribution: {
      id: detail.contribution.id,
      title: detail.contribution.title,
      body: detail.contribution.body ?? '',
      route: detail.contribution.payload?.route ?? null,
      context: detail.contribution.payload?.context ?? null,
      requesterRole: detail.contribution.payload?.user?.role ?? null,
    },
    approvedSpec:
      latestSpec == null
        ? null
        : {
            versionNumber: latestSpec.versionNumber,
            title: latestSpec.title,
            goal: latestSpec.goal,
            userProblem: latestSpec.userProblem,
            acceptanceCriteria: asArray(latestSpec.spec?.acceptanceCriteria),
            nonGoals: asArray(latestSpec.spec?.nonGoals),
            affectedRoute: latestSpec.spec?.affectedRoute ?? null,
            affectedContext: latestSpec.spec?.affectedContext ?? null,
          },
    attachments: asArray(detail.attachments).map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      kind: attachment.kind,
      sizeBytes: attachment.sizeBytes,
    })),
    repository: {
      profile: profile.id,
      runtime: profile.runtimeLabel,
      allowedFilePrefixes: profile.allowedPrefixes,
      contextFiles: repoFiles,
    },
    verificationFailure,
  };
}

export function createOpenAiImplementationService({
  apiKey,
  model = 'gpt-5.4',
  baseUrl = 'https://api.openai.com/v1',
  organization = null,
  project = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!normalizedApiKey) {
    throw new ImplementationServiceError('OPENAI_API_KEY is required for worker implementation edits.', {
      code: 'openai_not_configured',
      statusCode: 503,
    });
  }

  if (typeof fetchImpl !== 'function') {
    throw new ImplementationServiceError('Global fetch is required for worker implementation edits.', {
      code: 'fetch_unavailable',
      statusCode: 500,
    });
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  async function requestEditPayload(messages) {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        'Content-Type': 'application/json',
        ...(organization ? { 'OpenAI-Organization': organization } : {}),
        ...(project ? { 'OpenAI-Project': project } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        tools: [getEditToolDefinition()],
        tool_choice: {
          type: 'function',
          function: {
            name: 'submit_repo_edits',
          },
        },
      }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new ImplementationServiceError('OpenAI returned invalid JSON for implementation edits.', {
        code: 'openai_invalid_json',
        statusCode: 502,
      });
    }

    if (!response.ok) {
      throw new ImplementationServiceError(
        cleanText(payload?.error?.message, `OpenAI implementation request failed with status ${response.status}.`),
        {
          code: 'openai_request_failed',
          statusCode: 502,
        },
      );
    }

    return parseToolArguments(payload, 'submit_repo_edits');
  }

  return {
    async generateChanges({ detail, worktreePath, runtimeConfig = null }) {
      const profile = resolveImplementationProfile(detail, runtimeConfig);
      const rawResult = await requestEditPayload(
        buildImplementationMessages(
          'initial',
          buildImplementationPayload({ detail, worktreePath, runtimeConfig }),
          profile,
        ),
      );

      return {
        summary: cleanText(rawResult?.summary, 'Implemented the approved spec in the target repository.'),
        files: sanitizeImplementationEdits(worktreePath, rawResult?.files, {
          allowedPrefixes: profile.allowedPrefixes,
        }),
      };
    },

    async repairChanges({ detail, worktreePath, verificationFailure, runtimeConfig = null }) {
      const profile = resolveImplementationProfile(detail, runtimeConfig);
      const rawResult = await requestEditPayload(
        buildImplementationMessages(
          'repair',
          buildImplementationPayload({
            detail,
            worktreePath,
            verificationFailure,
            runtimeConfig,
          }),
          profile,
        ),
      );

      return {
        summary: cleanText(rawResult?.summary, 'Adjusted the implementation to resolve verification errors.'),
        files: sanitizeImplementationEdits(worktreePath, rawResult?.files, {
          allowedPrefixes: profile.allowedPrefixes,
        }),
      };
    },
  };
}

export function createConfiguredImplementationService(options = {}) {
  return createOpenAiImplementationService({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    model: options.model ?? process.env.OPENAI_IMPLEMENTATION_MODEL ?? 'gpt-5.4',
    baseUrl: options.baseUrl ?? process.env.OPENAI_IMPLEMENTATION_BASE_URL ?? 'https://api.openai.com/v1',
    organization: options.organization ?? process.env.OPENAI_ORGANIZATION ?? null,
    project: options.project ?? process.env.OPENAI_PROJECT ?? null,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}
