function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (raw || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function cleanText(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return normalized || fallback;
}

function buildCompletionPayload({ detail, mergedPullRequest, note }) {
  const contribution = detail?.contribution ?? {};
  const payload = contribution.payload ?? {};
  const context = payload.context ?? {};
  const latestSpec = Array.isArray(detail?.specVersions) ? detail.specVersions.at(-1) ?? null : null;
  const latestPreview = Array.isArray(detail?.previewDeployments) ? detail.previewDeployments.at(-1) ?? null : null;

  return {
    contribution: {
      title: contribution.title ?? '',
      route: payload.route ?? null,
      environment: contribution.environment ?? null,
      type: contribution.type ?? null,
    },
    requestContext: {
      selectedObjectType: context.selectedObjectType ?? null,
      selectedObjectId: context.selectedObjectId ?? null,
    },
    latestSpec:
      latestSpec == null
        ? null
        : {
            title: latestSpec.title,
            goal: latestSpec.goal,
            userProblem: latestSpec.userProblem,
            acceptanceCriteria: Array.isArray(latestSpec.spec?.acceptanceCriteria) ? latestSpec.spec.acceptanceCriteria : [],
            nonGoals: Array.isArray(latestSpec.spec?.nonGoals) ? latestSpec.spec.nonGoals : [],
          },
    mergedPullRequest:
      mergedPullRequest == null
        ? null
        : {
            number: mergedPullRequest.number,
            repositoryFullName: mergedPullRequest.repositoryFullName,
            url: mergedPullRequest.url,
          },
    latestPreview:
      latestPreview == null
        ? null
        : {
            url: latestPreview.url,
            status: latestPreview.status,
          },
    voteSummary: detail?.votes ?? null,
    operatorNote: note || null,
  };
}

function getCompletionToolDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_completion_summary',
      description:
        'Write a short user-facing completion explanation that says what changed, where to find it, and what was intentionally left out.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'Two to four short sentences. Mention the user-visible outcome, where to find it, and any important intentional omission.',
          },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  };
}

function parseToolArguments(payload, toolName) {
  const message = payload?.choices?.[0]?.message;

  if (!message) {
    throw new Error('OpenAI did not return a completion summary.');
  }

  if (message.refusal) {
    throw new Error(`OpenAI refused the completion summary request: ${message.refusal}`);
  }

  const toolCall = Array.isArray(message.tool_calls)
    ? message.tool_calls.find((candidate) => candidate?.function?.name === toolName)
    : null;

  if (!toolCall?.function?.arguments) {
    throw new Error('OpenAI did not return the expected completion summary payload.');
  }

  return JSON.parse(toolCall.function.arguments);
}

function buildMessages(payload) {
  return [
    {
      role: 'system',
      content:
        'You write concise product-facing completion explanations for software changes. Focus on what changed for the user, where to find it, and what was intentionally left out. Do not mention CI, prompts, code generation, or internal tooling.',
    },
    {
      role: 'user',
      content: `Write the completion explanation from this JSON:\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

function createDisabledCompletionService(message) {
  return {
    async summarizeCompletion({ fallbackSummary }) {
      return {
        summary: fallbackSummary,
        metadata: {
          provider: 'fallback',
          reason: message,
        },
      };
    },
  };
}

export function createOpenAiCompletionService({
  apiKey,
  model = 'gpt-5.4',
  baseUrl = 'https://api.openai.com/v1',
  organization = null,
  project = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';

  if (!normalizedApiKey) {
    return createDisabledCompletionService('OPENAI_API_KEY is not configured for completion summaries.');
  }

  if (typeof fetchImpl !== 'function') {
    return createDisabledCompletionService('Global fetch is unavailable for completion summaries.');
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  async function requestSummary(payload) {
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
        messages: buildMessages(payload),
        tools: [getCompletionToolDefinition()],
        tool_choice: {
          type: 'function',
          function: {
            name: 'submit_completion_summary',
          },
        },
      }),
    });

    const data = await response.json().catch(() => {
      throw new Error('OpenAI returned invalid JSON for completion summaries.');
    });

    if (!response.ok) {
      throw new Error(cleanText(data?.error?.message, `OpenAI request failed with status ${response.status}.`));
    }

    return parseToolArguments(data, 'submit_completion_summary');
  }

  return {
    async summarizeCompletion({ detail, mergedPullRequest, note = '', fallbackSummary }) {
      try {
        const rawResult = await requestSummary(
          buildCompletionPayload({
            detail,
            mergedPullRequest,
            note,
          }),
        );

        return {
          summary: cleanText(rawResult?.summary, fallbackSummary),
          metadata: {
            provider: 'openai',
            model,
          },
        };
      } catch (error) {
        return {
          summary: fallbackSummary,
          metadata: {
            provider: 'fallback',
            model,
            reason: error instanceof Error ? error.message : 'Completion summary generation failed.',
          },
        };
      }
    },
  };
}

export function createConfiguredCompletionService(options = {}) {
  return createOpenAiCompletionService({
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? '',
    model: options.model ?? process.env.OPENAI_COMPLETION_MODEL ?? 'gpt-5.4',
    baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    organization: options.organization ?? process.env.OPENAI_ORGANIZATION ?? null,
    project: options.project ?? process.env.OPENAI_PROJECT ?? null,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}
