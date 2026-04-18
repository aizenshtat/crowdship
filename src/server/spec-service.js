function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (raw || 'https://api.openai.com/v1').replace(/\/+$/, '');
}

function cleanText(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return normalized || fallback;
}

function cleanSentence(value, fallback) {
  const normalized = cleanText(value, fallback);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function cleanList(items, { fallback = [], max = 5 } = {}) {
  const seen = new Set();
  const normalized = [];

  for (const item of Array.isArray(items) ? items : []) {
    const text = typeof item === 'string' ? item.trim().replace(/\s+/g, ' ') : '';
    if (!text) {
      continue;
    }

    const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
    const key = sentence.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(sentence);

    if (normalized.length >= max) {
      break;
    }
  }

  return normalized.length > 0 ? normalized : fallback.slice(0, max);
}

function cleanQuestionList(items, fallback) {
  const questions = [];

  for (const item of Array.isArray(items) ? items : []) {
    const question = cleanText(item?.question, '');
    if (!question) {
      continue;
    }

    questions.push({
      id: cleanText(item?.id, `question-${questions.length + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      question: cleanSentence(question, question),
      why: cleanSentence(item?.why, 'This helps narrow the scope.'),
      suggestedAnswerFormat: cleanText(item?.suggestedAnswerFormat, 'Short sentence or bullet list'),
    });

    if (questions.length >= 3) {
      break;
    }
  }

  return questions.length > 0 ? questions : fallback;
}

function buildFallbackQuestions(contribution) {
  const route = contribution.payload?.route ?? 'the current screen';

  return [
    {
      id: 'desired-outcome',
      question: cleanSentence(
        `What should the user be able to do on ${route} after this change?`,
        'What should the user be able to do after this change?',
      ),
      why: 'This defines the visible product outcome.',
      suggestedAnswerFormat: 'One short sentence',
    },
    {
      id: 'stay-unchanged',
      question: 'What should stay unchanged while we add this?',
      why: 'This helps set non-goals and preserve existing workflows.',
      suggestedAnswerFormat: 'Short bullet list',
    },
    {
      id: 'success-signal',
      question: 'How will you know this change is successful?',
      why: 'This turns the request into concrete acceptance criteria.',
      suggestedAnswerFormat: 'One or two observable signals',
    },
  ];
}

export class SpecServiceError extends Error {
  constructor(message, { code = 'spec_generation_failed', statusCode = 502 } = {}) {
    super(message);
    this.name = 'SpecServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isSpecServiceError(error) {
  return error instanceof SpecServiceError;
}

function createDisabledSpecService(message) {
  return {
    async startConversation() {
      throw new SpecServiceError(message, {
        code: 'openai_not_configured',
        statusCode: 503,
      });
    },
    async continueConversation() {
      throw new SpecServiceError(message, {
        code: 'openai_not_configured',
        statusCode: 503,
      });
    },
    async refineSpec() {
      throw new SpecServiceError(message, {
        code: 'openai_not_configured',
        statusCode: 503,
      });
    },
  };
}

function buildFallbackGoal(contribution, refinementNote = null) {
  const base = cleanSentence(contribution.title, 'Clarify the requested product change.');

  if (!refinementNote) {
    return base;
  }

  return cleanSentence(
    `Update ${contribution.title} with this requester refinement: ${refinementNote}`,
    base,
  );
}

function buildFallbackUserProblem(contribution, refinementNote = null) {
  const body = contribution.body ?? contribution.title;
  const fallback = cleanSentence(body, 'The requester needs a clearer product outcome.');

  if (!refinementNote) {
    return fallback;
  }

  return cleanSentence(`${body} Latest refinement: ${refinementNote}`, fallback);
}

function buildConversationPayload({ contribution, attachments = [], messages = [], currentSpec = null, refinementNote = null }) {
  return {
    project: contribution.projectSlug,
    environment: contribution.environment,
    request: {
      type: contribution.type,
      title: contribution.title,
      body: contribution.body ?? '',
      route: contribution.payload?.route ?? null,
      url: contribution.payload?.url ?? null,
      appVersion: contribution.payload?.appVersion ?? null,
    },
    requester: {
      role: contribution.payload?.user?.role ?? null,
      timezone: contribution.payload?.client?.timezone ?? null,
      locale: contribution.payload?.client?.locale ?? null,
    },
    productContext: contribution.payload?.context ?? null,
    attachments: attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      kind: attachment.kind,
      sizeBytes: attachment.sizeBytes,
    })),
    conversation: messages.map((message) => ({
      authorRole: message.authorRole,
      messageType: message.messageType,
      body: message.body,
      choices: message.choices ?? null,
    })),
    currentSpec:
      currentSpec == null
        ? null
        : {
            title: currentSpec.title,
            goal: currentSpec.goal,
            userProblem: currentSpec.userProblem,
            acceptanceCriteria: Array.isArray(currentSpec.spec?.acceptanceCriteria)
              ? currentSpec.spec.acceptanceCriteria
              : [],
            nonGoals: Array.isArray(currentSpec.spec?.nonGoals) ? currentSpec.spec.nonGoals : [],
          },
    requesterRefinement: refinementNote,
  };
}

function getTurnFunctionDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_intake_turn',
      description:
        'Return the next user-facing intake step: either a compact set of clarification questions or a draft spec.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['ask_user', 'draft_spec'],
          },
          assistantMessage: {
            type: 'string',
          },
          questions: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                question: { type: 'string' },
                why: { type: 'string' },
                suggestedAnswerFormat: { type: 'string' },
              },
              required: ['id', 'question'],
              additionalProperties: false,
            },
          },
          goal: { type: 'string' },
          userProblem: { type: 'string' },
          acceptanceCriteria: {
            type: 'array',
            maxItems: 5,
            items: { type: 'string' },
          },
          nonGoals: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string' },
          },
        },
        required: ['action', 'assistantMessage'],
        additionalProperties: false,
      },
    },
  };
}

function getRefineSpecFunctionDefinition() {
  return {
    type: 'function',
    function: {
      name: 'submit_refined_spec',
      description: 'Return the revised approval-ready spec for the requester.',
      parameters: {
        type: 'object',
        properties: {
          assistantMessage: {
            type: 'string',
          },
          goal: {
            type: 'string',
          },
          userProblem: {
            type: 'string',
          },
          acceptanceCriteria: {
            type: 'array',
            minItems: 3,
            maxItems: 5,
            items: { type: 'string' },
          },
          nonGoals: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: { type: 'string' },
          },
        },
        required: [
          'assistantMessage',
          'goal',
          'userProblem',
          'acceptanceCriteria',
          'nonGoals',
        ],
        additionalProperties: false,
      },
    },
  };
}

function buildTurnMessages(mode, payload) {
  const system = [
    'You are Crowdship, a product requirements assistant for external customer-requested software changes.',
    'Focus on user-facing product behavior, not implementation internals.',
    'Use only the request, route, context, attachment metadata, and conversation that were provided.',
    'Do not invent APIs, hidden systems, credentials, code structure, or deployment details.',
    'When you ask questions, ask only the highest-leverage questions that will materially improve the spec.',
    'When you draft a spec, keep it crisp and approval-ready for a product owner.',
    'Assistant language must feel like a clean product conversation, not boilerplate.',
  ].join(' ');

  const instructionsByMode = {
    initial:
      'This is the first AI turn. Always ask the requester 1 to 3 concise clarification questions before drafting a spec.',
    reply:
      'This is a follow-up turn after the requester answered. If the latest answer gives enough information, draft the spec. Otherwise ask at most 2 more concise questions.',
    refine:
      'The requester reviewed a draft spec and asked for a revision. Return a revised approval-ready spec now; do not ask more questions in this mode.',
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
        contribution: payload,
      }),
    },
  ];
}

function parseToolArguments(payload, toolName) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const message = choice?.message ?? null;

  if (message?.refusal) {
    throw new SpecServiceError(`OpenAI refused the request: ${message.refusal}`, {
      code: 'openai_refused',
      statusCode: 502,
    });
  }

  const toolCall = Array.isArray(message?.tool_calls)
    ? message.tool_calls.find((entry) => entry?.function?.name === toolName)
    : null;

  if (!toolCall?.function?.arguments) {
    throw new SpecServiceError('OpenAI did not return the expected structured tool result.', {
      code: 'openai_invalid_response',
      statusCode: 502,
    });
  }

  return JSON.parse(toolCall.function.arguments);
}

function sanitizeTurnResult(rawResult, { contribution, fallbackAcceptanceCriteria, fallbackNonGoals, forceQuestionTurn = false }) {
  const fallbackQuestions = buildFallbackQuestions(contribution);
  const action = forceQuestionTurn ? 'ask_user' : rawResult?.action === 'draft_spec' ? 'draft_spec' : 'ask_user';

  if (action === 'ask_user') {
    return {
      action,
      assistantMessage: cleanText(
        rawResult?.assistantMessage,
        `Before I draft the spec for ${contribution.title}, I need a bit more detail.`,
      ),
      questions: cleanQuestionList(rawResult?.questions, fallbackQuestions),
    };
  }

  return {
    action,
    assistantMessage: cleanText(
      rawResult?.assistantMessage,
      `I drafted the spec for ${contribution.title}.`,
    ),
    goal: cleanSentence(rawResult?.goal, buildFallbackGoal(contribution)),
    userProblem: cleanSentence(rawResult?.userProblem, buildFallbackUserProblem(contribution)),
    acceptanceCriteria: cleanList(rawResult?.acceptanceCriteria, {
      fallback: fallbackAcceptanceCriteria,
      max: 5,
    }),
    nonGoals: cleanList(rawResult?.nonGoals, {
      fallback: fallbackNonGoals,
      max: 4,
    }),
  };
}

function sanitizeRefinedSpec(rawResult, { contribution, fallbackAcceptanceCriteria, fallbackNonGoals, refinementNote }) {
  return {
    assistantMessage: cleanText(
      rawResult?.assistantMessage,
      `I updated the spec for ${contribution.title}.`,
    ),
    goal: cleanSentence(rawResult?.goal, buildFallbackGoal(contribution, refinementNote)),
    userProblem: cleanSentence(
      rawResult?.userProblem,
      buildFallbackUserProblem(contribution, refinementNote),
    ),
    acceptanceCriteria: cleanList(rawResult?.acceptanceCriteria, {
      fallback: fallbackAcceptanceCriteria,
      max: 5,
    }),
    nonGoals: cleanList(rawResult?.nonGoals, {
      fallback: fallbackNonGoals,
      max: 4,
    }),
  };
}

export function createOpenAiSpecService({
  apiKey,
  model = 'gpt-5.4',
  baseUrl = 'https://api.openai.com/v1',
  organization = null,
  project = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!normalizedApiKey) {
    return createDisabledSpecService('OPENAI_API_KEY is required for Crowdship intake chat.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new SpecServiceError('Global fetch is required for Crowdship intake chat.', {
      code: 'fetch_unavailable',
      statusCode: 500,
    });
  }

  const endpoint = `${normalizeBaseUrl(baseUrl)}/chat/completions`;

  async function requestToolResult({ messages, tool, toolName }) {
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
        tools: [tool],
        tool_choice: {
          type: 'function',
          function: {
            name: toolName,
          },
        },
      }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      throw new SpecServiceError('OpenAI returned invalid JSON.', {
        code: 'openai_invalid_json',
        statusCode: 502,
      });
    }

    if (!response.ok) {
      const upstreamMessage = cleanText(
        payload?.error?.message,
        `OpenAI request failed with status ${response.status}.`,
      );
      throw new SpecServiceError(upstreamMessage, {
        code: 'openai_request_failed',
        statusCode: 502,
      });
    }

    return parseToolArguments(payload, toolName);
  }

  return {
    async startConversation({
      contribution,
      attachments = [],
      fallbackAcceptanceCriteria = [],
      fallbackNonGoals = [],
      messages = [],
    }) {
      const rawResult = await requestToolResult({
        messages: buildTurnMessages(
          'initial',
          buildConversationPayload({
            contribution,
            attachments,
            messages,
          }),
        ),
        tool: getTurnFunctionDefinition(),
        toolName: 'submit_intake_turn',
      });

      return {
        ...sanitizeTurnResult(rawResult, {
          contribution,
          fallbackAcceptanceCriteria,
          fallbackNonGoals,
          forceQuestionTurn: true,
        }),
        metadata: {
          provider: 'openai',
          model,
        },
      };
    },

    async continueConversation({
      contribution,
      attachments = [],
      fallbackAcceptanceCriteria = [],
      fallbackNonGoals = [],
      messages = [],
    }) {
      const rawResult = await requestToolResult({
        messages: buildTurnMessages(
          'reply',
          buildConversationPayload({
            contribution,
            attachments,
            messages,
          }),
        ),
        tool: getTurnFunctionDefinition(),
        toolName: 'submit_intake_turn',
      });

      return {
        ...sanitizeTurnResult(rawResult, {
          contribution,
          fallbackAcceptanceCriteria,
          fallbackNonGoals,
          forceQuestionTurn: false,
        }),
        metadata: {
          provider: 'openai',
          model,
        },
      };
    },

    async refineSpec({
      contribution,
      attachments = [],
      currentSpec = null,
      refinementNote = null,
      fallbackAcceptanceCriteria = [],
      fallbackNonGoals = [],
      messages = [],
    }) {
      const rawResult = await requestToolResult({
        messages: buildTurnMessages(
          'refine',
          buildConversationPayload({
            contribution,
            attachments,
            messages,
            currentSpec,
            refinementNote,
          }),
        ),
        tool: getRefineSpecFunctionDefinition(),
        toolName: 'submit_refined_spec',
      });

      return {
        ...sanitizeRefinedSpec(rawResult, {
          contribution,
          fallbackAcceptanceCriteria,
          fallbackNonGoals,
          refinementNote,
        }),
        metadata: {
          provider: 'openai',
          model,
        },
      };
    },
  };
}

export function createConfiguredSpecService(options = {}) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';

  if (!String(apiKey).trim()) {
    return createDisabledSpecService('OPENAI_API_KEY is required for Crowdship intake chat.');
  }

  return createOpenAiSpecService({
    apiKey,
    model: options.model ?? process.env.OPENAI_INTAKE_MODEL ?? 'gpt-5.4',
    baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    organization: options.organization ?? process.env.OPENAI_ORGANIZATION ?? null,
    project: options.project ?? process.env.OPENAI_PROJECT ?? null,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  });
}
