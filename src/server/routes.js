import { randomUUID } from 'node:crypto';

import {
  AGENT_QUEUED_CONTRIBUTION_STATE,
  API_ROUTE_DEFINITIONS,
  APPROVED_SPEC_PROGRESS_EVENT_KIND,
  CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
  CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  CONTRIBUTION_STATES,
  GENERATED_SPEC_PROGRESS_EVENT_KIND,
  IMPLEMENTATION_FAILED_CONTRIBUTION_STATE,
  INITIAL_CONTRIBUTION_STATE,
  MARKED_MERGED_PROGRESS_EVENT_KIND,
  MERGED_CONTRIBUTION_STATE,
  OPENED_VOTING_PROGRESS_EVENT_KIND,
  PREVIEW_DEPLOYING_CONTRIBUTION_STATE,
  PREVIEW_FAILED_CONTRIBUTION_STATE,
  PREVIEW_READY_CONTRIBUTION_STATE,
  PR_OPENED_CONTRIBUTION_STATE,
  QUEUED_IMPLEMENTATION_PROGRESS_EVENT_KIND,
  RECORDED_PREVIEW_DEPLOYMENT_PROGRESS_EVENT_KIND,
  RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND,
  REFINED_SPEC_PROGRESS_EVENT_KIND,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
  VOTING_OPEN_CONTRIBUTION_STATE,
  getProjectPublicConfig,
  validateCommentPayload,
  validateContributionCreatePayload,
  validateContributionMessagePayload,
  validatePreviewDeploymentPayload,
  validatePullRequestPayload,
  validateQueueImplementationPayload,
  validateSpecApprovalPayload,
  validateVotePayload,
} from '../shared/contracts.js';
import { createConfiguredSpecService, isSpecServiceError } from './spec-service.js';

export { API_ROUTE_DEFINITIONS };

function buildResponse(status, body) {
  return {
    status,
    body,
  };
}

function notWiredResponse(message = 'Persistence is not wired yet.') {
  return buildResponse(501, {
    error: 'not_wired',
    message,
  });
}

function specServiceErrorResponse(error) {
  if (isSpecServiceError(error)) {
    return buildResponse(error.statusCode, {
      error: error.code,
      message: error.message,
    });
  }

  return buildResponse(502, {
    error: 'spec_generation_failed',
    message: error instanceof Error ? error.message : 'Spec generation failed.',
  });
}

function hasReadyPersistence(database, methodName) {
  return Boolean(database && database.connected === true && typeof database[methodName] === 'function');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const MAX_CLARIFICATION_ANSWERS = 3;

function formatSentence(value, fallback) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

  if (!text) {
    return fallback;
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function humanizeSelection(context = {}) {
  const selectedObjectType = typeof context.selectedObjectType === 'string' ? context.selectedObjectType.trim() : '';
  const selectedObjectId = typeof context.selectedObjectId === 'string' ? context.selectedObjectId.trim() : '';

  if (!selectedObjectType && !selectedObjectId) {
    return 'current mission context';
  }

  return [selectedObjectType, selectedObjectId].filter(Boolean).join(' ');
}

function createAttachmentRecord(attachment, contributionId, createdAt, idFactory) {
  return {
    id: idFactory(),
    contributionId,
    kind: attachment.kind,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: Number(attachment.sizeBytes),
    storageKey: `metadata-only://${contributionId}/${encodeURIComponent(attachment.filename)}`,
    createdAt,
  };
}

function createUserMessage({ id, contributionId, body, createdAt, messageType = 'request' }) {
  return {
    id,
    contributionId,
    authorRole: 'requester',
    messageType,
    body,
    choices: null,
    metadata: null,
    createdAt,
  };
}

function createAgentMessage({
  id,
  contributionId,
  body,
  createdAt,
  metadata = null,
  messageType = 'spec_ready',
  choices = null,
}) {
  return {
    id,
    contributionId,
    authorRole: 'agent',
    messageType,
    body,
    choices,
    metadata,
    createdAt,
  };
}

function countClarificationAnswers(messages) {
  return asArray(messages).filter(
    (message) =>
      message?.authorRole === 'requester' && message?.messageType === 'clarification_answer',
  ).length;
}

function buildAcceptanceCriteria({ contribution, attachments, revisionNote }) {
  const payload = contribution.payload ?? {};
  const context = payload.context ?? {};
  const criteria = [];

  if (payload.route) {
    criteria.push(`The change is available from ${payload.route}.`);
  }

  criteria.push(`The workflow keeps the ${humanizeSelection(context)} in context while the request is used.`);

  if (attachments.length > 0) {
    criteria.push('The implementation respects the attached reference material.');
  }

  if (revisionNote) {
    criteria.push(formatSentence(`The updated scope addresses this requester note: ${revisionNote}`, 'The updated scope addresses the requester refinement.'));
  }

  criteria.push('Failures keep the requester on the same route with a clear recovery path.');

  if (contribution.type === 'bug_report') {
    criteria.push('The broken path has an explicit fix and does not regress the surrounding mission flow.');
  } else {
    criteria.push('The requested outcome is visible in the primary mission workflow without extra setup.');
  }

  return criteria.slice(0, 5);
}

function buildNonGoals(contribution) {
  const nonGoals = [
    'New authentication or permission tiers.',
    'Backoffice-only controls that do not affect the requester flow.',
  ];

  if (contribution.type === 'bug_report') {
    nonGoals.push('A broader redesign of unrelated mission-control surfaces.');
  } else {
    nonGoals.push('A full replay or telemetry architecture rewrite outside the requested flow.');
  }

  return nonGoals.slice(0, 3);
}

function buildSpecVersionRecord({
  id,
  contribution,
  versionNumber,
  attachments,
  createdAt,
  revisionNote = null,
  generatedSpec = null,
}) {
  const goal = formatSentence(
    generatedSpec?.goal ??
      (revisionNote
        ? `Update ${contribution.title} with the latest requester refinement`
        : contribution.title),
    'Clarify the requested product change.',
  );
  const userProblem = formatSentence(
    generatedSpec?.userProblem ??
      (revisionNote
        ? `${contribution.body ?? contribution.title} Latest refinement: ${revisionNote}`
        : contribution.body ?? contribution.title),
    'The requester needs a clearer product outcome.',
  );

  return {
    id,
    contributionId: contribution.id,
    versionNumber,
    title: contribution.title,
    goal,
    userProblem,
    spec: {
      acceptanceCriteria:
        Array.isArray(generatedSpec?.acceptanceCriteria) && generatedSpec.acceptanceCriteria.length > 0
          ? generatedSpec.acceptanceCriteria.map((item) =>
              formatSentence(item, 'The requested outcome is visible in the primary mission workflow.'),
            )
          : buildAcceptanceCriteria({
              contribution,
              attachments,
              revisionNote,
            }),
      nonGoals:
        Array.isArray(generatedSpec?.nonGoals) && generatedSpec.nonGoals.length > 0
          ? generatedSpec.nonGoals.map((item) =>
              formatSentence(item, 'Avoid unrelated workflow changes.'),
            )
          : buildNonGoals(contribution),
      affectedRoute: contribution.payload?.route ?? null,
      affectedContext: contribution.payload?.context ?? null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
        kind: attachment.kind,
      })),
      revisionNote,
    },
    approvedAt: null,
    createdAt,
  };
}

function serializeContribution(contribution) {
  return {
    id: contribution.id,
    projectSlug: contribution.projectSlug,
    environment: contribution.environment,
    type: contribution.type,
    title: contribution.title,
    body: contribution.body ?? null,
    state: contribution.state,
    payload: contribution.payload,
    createdAt: contribution.createdAt,
    updatedAt: contribution.updatedAt,
  };
}

function serializeProgressEvent(event) {
  return {
    id: event.id,
    contributionId: event.contributionId,
    kind: event.kind,
    status: event.status,
    message: event.message,
    externalUrl: event.externalUrl ?? null,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  };
}

function serializeAttachment(attachment) {
  return {
    id: attachment.id,
    contributionId: attachment.contributionId,
    kind: attachment.kind,
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    storageKey: attachment.storageKey,
    createdAt: attachment.createdAt,
  };
}

function serializeMessage(message) {
  return {
    id: message.id,
    contributionId: message.contributionId,
    authorRole: message.authorRole,
    messageType: message.messageType,
    body: message.body,
    choices: message.choices ?? null,
    metadata: message.metadata ?? null,
    createdAt: message.createdAt,
  };
}

function serializeSpecVersion(specVersion) {
  const spec = specVersion.spec ?? {};

  return {
    id: specVersion.id,
    contributionId: specVersion.contributionId,
    versionNumber: specVersion.versionNumber,
    title: specVersion.title,
    goal: specVersion.goal,
    userProblem: specVersion.userProblem,
    acceptanceCriteria: asArray(spec.acceptanceCriteria),
    nonGoals: asArray(spec.nonGoals),
    affectedRoute: spec.affectedRoute ?? null,
    affectedContext: spec.affectedContext ?? null,
    attachments: asArray(spec.attachments),
    revisionNote: spec.revisionNote ?? null,
    approvedAt: specVersion.approvedAt ?? null,
    createdAt: specVersion.createdAt,
  };
}

function getLatestSpecVersion(specVersions) {
  return asArray(specVersions)
    .slice()
    .sort((left, right) => right.versionNumber - left.versionNumber)[0] ?? null;
}

function getLatestByCreatedAt(records) {
  return asArray(records)
    .slice()
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0] ?? null;
}

function getContributionStateIndex(state) {
  return CONTRIBUTION_STATES.indexOf(state);
}

function advanceContributionState(currentState, candidateState) {
  if (!candidateState) {
    return currentState;
  }

  const currentIndex = getContributionStateIndex(currentState);
  const candidateIndex = getContributionStateIndex(candidateState);

  if (currentIndex === -1 || candidateIndex === -1) {
    return candidateState;
  }

  return candidateIndex > currentIndex ? candidateState : currentState;
}

function serializeImplementationJob(job) {
  return {
    id: job.id,
    contributionId: job.contributionId,
    status: job.status,
    queueName: job.queueName,
    branchName: job.branchName ?? null,
    repositoryFullName: job.repositoryFullName ?? null,
    githubRunId: job.githubRunId ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    errorSummary: job.errorSummary ?? null,
    metadata: job.metadata ?? null,
    createdAt: job.createdAt,
  };
}

function serializePullRequest(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    repositoryFullName: record.repositoryFullName,
    number: record.number,
    url: record.url,
    branchName: record.branchName,
    headSha: record.headSha ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function serializePreviewDeployment(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    pullRequestId: record.pullRequestId ?? null,
    url: record.url,
    status: record.status,
    gitSha: record.gitSha ?? null,
    deployKind: record.deployKind,
    deployedAt: record.deployedAt ?? null,
    checkedAt: record.checkedAt ?? null,
    errorSummary: record.errorSummary ?? null,
    createdAt: record.createdAt,
  };
}

function serializeVote(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    voterUserId: record.voterUserId ?? null,
    voterEmail: record.voterEmail ?? null,
    voteType: record.voteType,
    createdAt: record.createdAt,
  };
}

function serializeComment(record) {
  return {
    id: record.id,
    contributionId: record.contributionId,
    authorUserId: record.authorUserId ?? null,
    authorRole: record.authorRole,
    body: record.body,
    disposition: record.disposition,
    createdAt: record.createdAt,
  };
}

function summarizeVotes(votes) {
  const summary = {
    approve: 0,
    block: 0,
    total: 0,
  };

  for (const vote of asArray(votes)) {
    if (vote.voteType === 'approve') {
      summary.approve += 1;
    } else if (vote.voteType === 'block') {
      summary.block += 1;
    }
    summary.total += 1;
  }

  return summary;
}

function deriveContributionAdminBucket(contribution, implementationJobs = [], previewDeployments = []) {
  const latestImplementationJob = getLatestByCreatedAt(implementationJobs);
  const latestPreviewDeployment = getLatestByCreatedAt(previewDeployments);

  if (
    contribution.state === IMPLEMENTATION_FAILED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_FAILED_CONTRIBUTION_STATE ||
    latestImplementationJob?.status === 'failed' ||
    latestPreviewDeployment?.status === 'failed'
  ) {
    return 'attention';
  }

  if (contribution.state === MERGED_CONTRIBUTION_STATE || contribution.state === 'completed' || contribution.state === 'rejected') {
    return 'done';
  }

  if (
    contribution.state === AGENT_QUEUED_CONTRIBUTION_STATE ||
    contribution.state === 'agent_running' ||
    contribution.state === PR_OPENED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_DEPLOYING_CONTRIBUTION_STATE ||
    latestImplementationJob?.status === 'queued' ||
    latestImplementationJob?.status === 'running' ||
    latestPreviewDeployment?.status === 'deploying'
  ) {
    return 'active';
  }

  if (
    contribution.state === SPEC_APPROVED_CONTRIBUTION_STATE ||
    contribution.state === PREVIEW_READY_CONTRIBUTION_STATE ||
    contribution.state === 'requester_review' ||
    contribution.state === 'ready_for_voting' ||
    contribution.state === VOTING_OPEN_CONTRIBUTION_STATE ||
    contribution.state === 'core_team_flagged' ||
    contribution.state === 'core_review'
  ) {
    return 'ready';
  }

  return 'waiting';
}

function buildContributionSnapshot(detail) {
  const attachments = asArray(detail.attachments);
  const messages = asArray(detail.messages);
  const specVersions = asArray(detail.specVersions);
  const progressEvents = asArray(detail.progressEvents);
  const implementationJobs = asArray(detail.implementationJobs);
  const pullRequests = asArray(detail.pullRequests);
  const previewDeployments = asArray(detail.previewDeployments);
  const votes = asArray(detail.votes);
  const comments = asArray(detail.comments);
  const latestSpec = getLatestSpecVersion(specVersions);
  const currentImplementationJob = getLatestByCreatedAt(implementationJobs);

  return {
    contribution: serializeContribution(detail.contribution),
    attachments: attachments.map(serializeAttachment),
    conversation: messages.map(serializeMessage),
    spec: {
      current: latestSpec ? serializeSpecVersion(latestSpec) : null,
      versions: specVersions.map(serializeSpecVersion),
    },
    lifecycle: {
      currentState: detail.contribution.state,
      events: progressEvents.map(serializeProgressEvent),
    },
    review: {
      implementation: {
        current: currentImplementationJob ? serializeImplementationJob(currentImplementationJob) : null,
        jobs: implementationJobs.map(serializeImplementationJob),
      },
      pullRequests: pullRequests.map(serializePullRequest),
      previewDeployments: previewDeployments.map(serializePreviewDeployment),
      votes: {
        summary: summarizeVotes(votes),
        items: votes.map(serializeVote),
      },
      comments: comments.map(serializeComment),
    },
  };
}

function serializeContributionSummary(
  contribution,
  specVersions = [],
  implementationJobs = [],
  pullRequests = [],
  previewDeployments = [],
) {
  const latestSpec = getLatestSpecVersion(specVersions);
  const latestImplementationJob = getLatestByCreatedAt(implementationJobs);
  const latestPullRequest = getLatestByCreatedAt(pullRequests);
  const latestPreviewDeployment = getLatestByCreatedAt(previewDeployments);

  return {
    ...serializeContribution(contribution),
    latestSpecVersion: latestSpec?.versionNumber ?? null,
    specApprovedAt: latestSpec?.approvedAt ?? null,
    latestImplementationJob: latestImplementationJob ? serializeImplementationJob(latestImplementationJob) : null,
    latestPullRequest: latestPullRequest ? serializePullRequest(latestPullRequest) : null,
    latestPreviewDeployment: latestPreviewDeployment ? serializePreviewDeployment(latestPreviewDeployment) : null,
    adminBucket: deriveContributionAdminBucket(contribution, implementationJobs, previewDeployments),
  };
}

export function createHealthHandler() {
  return () =>
    buildResponse(200, {
      ok: true,
      service: 'crowdship-api',
      version: 'v1',
    });
}

export function createProjectPublicConfigHandler() {
  return ({ params = {} } = {}) => {
    const config = getProjectPublicConfig(params.project);

    if (!config) {
      return buildResponse(404, {
        error: 'project_not_found',
        project: params.project ?? null,
      });
    }

    return buildResponse(200, config);
  };
}

export function createContributionListHandler({ database } = {}) {
  return async () => {
    if (!hasReadyPersistence(database, 'listContributions')) {
      return notWiredResponse('Contribution persistence is not wired yet.');
    }

    const details = await database.listContributions();
    const contributions = details
      .slice()
      .sort((left, right) => String(right.contribution.createdAt).localeCompare(String(left.contribution.createdAt)))
      .map((detail) =>
        serializeContributionSummary(
          detail.contribution,
          detail.specVersions,
          detail.implementationJobs,
          detail.pullRequests,
          detail.previewDeployments,
        ),
      );

    return buildResponse(200, {
      contributions,
    });
  };
}

export function createContributionDetailHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail')) {
      return notWiredResponse('Contribution detail persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildResponse(200, buildContributionSnapshot(detail));
  };
}

export function createContributionHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ body } = {}) => {
    const validation = validateContributionCreatePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_contribution_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'createContribution')) {
      return notWiredResponse('Contribution persistence is not wired yet.');
    }

    const createdAt = clock().toISOString();
    const contributionId = idFactory();
    const attachments = validation.value.attachments.map((attachment) =>
      createAttachmentRecord(attachment, contributionId, createdAt, idFactory),
    );
    const contribution = {
      id: contributionId,
      projectSlug: validation.value.project,
      environment: validation.value.environment,
      type: validation.value.type,
      title: validation.value.title,
      body: validation.value.body ?? null,
      state: INITIAL_CONTRIBUTION_STATE,
      payload: validation.value,
      createdAt,
      updatedAt: createdAt,
    };
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: validation.value.body ?? validation.value.title,
      createdAt,
    });

    let openingTurn;
    try {
      openingTurn = await specService.startConversation({
        contribution,
        attachments,
        fallbackAcceptanceCriteria: buildAcceptanceCriteria({
          contribution,
          attachments,
          revisionNote: null,
        }),
        fallbackNonGoals: buildNonGoals(contribution),
        messages: [requesterMessage],
      });
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    const createdEvent = {
      id: idFactory(),
      contributionId,
      kind: CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'Contribution created.',
      externalUrl: null,
      payload: {
        contributionId,
        projectSlug: validation.value.project,
        environment: validation.value.environment,
        type: validation.value.type,
      },
      createdAt,
    };
    const messages = [requesterMessage];
    const specVersions = [];
    const progressEvents = [createdEvent];

    if (openingTurn.action === 'draft_spec') {
      contribution.state = SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE;
      const specVersion = buildSpecVersionRecord({
        id: idFactory(),
        contribution,
        versionNumber: 1,
        attachments,
        createdAt,
        generatedSpec: openingTurn,
      });
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: openingTurn.assistantMessage,
        createdAt,
        metadata: {
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
          ...openingTurn.metadata,
        },
      });
      const specEvent = {
        id: idFactory(),
        contributionId,
        kind: GENERATED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        message: 'Spec v1 ready for approval.',
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
        },
        createdAt,
      };
      messages.push(agentMessage);
      specVersions.push(specVersion);
      progressEvents.push(specEvent);
    } else {
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: openingTurn.assistantMessage,
        createdAt,
        messageType: 'ask_user_questions',
        choices: openingTurn.questions,
        metadata: {
          questionCount: Array.isArray(openingTurn.questions) ? openingTurn.questions.length : 0,
          ...openingTurn.metadata,
        },
      });
      const clarificationEvent = {
        id: idFactory(),
        contributionId,
        kind: CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
        status: INITIAL_CONTRIBUTION_STATE,
        message: 'Clarification questions sent.',
        externalUrl: null,
        payload: {
          contributionId,
          questionCount: Array.isArray(openingTurn.questions) ? openingTurn.questions.length : 0,
        },
        createdAt,
      };
      messages.push(agentMessage);
      progressEvents.push(clarificationEvent);
    }

    const persisted = await database.createContribution({
      contribution,
      attachments,
      messages,
      specVersions,
      progressEvents,
    });

    return buildResponse(201, buildContributionSnapshot(persisted));
  };
}

export function createContributionMessageHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateContributionMessagePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_contribution_message_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Contribution conversation persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (detail.contribution.state !== INITIAL_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'contribution_not_accepting_messages',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: validation.value.body,
      createdAt,
      messageType: 'clarification_answer',
    });
    const nextConversation = asArray(detail.messages).concat(requesterMessage);
    const clarificationAnswerCount = countClarificationAnswers(nextConversation);
    const shouldForceDraft =
      clarificationAnswerCount >= MAX_CLARIFICATION_ANSWERS &&
      typeof specService.finalizeConversation === 'function';

    let nextTurn;
    try {
      nextTurn = await (shouldForceDraft
        ? specService.finalizeConversation({
            contribution: {
              ...detail.contribution,
              updatedAt: createdAt,
            },
            attachments: asArray(detail.attachments),
            fallbackAcceptanceCriteria: buildAcceptanceCriteria({
              contribution: detail.contribution,
              attachments: asArray(detail.attachments),
              revisionNote: validation.value.body,
            }),
            fallbackNonGoals: buildNonGoals(detail.contribution),
            messages: nextConversation,
          })
        : specService.continueConversation({
            contribution: {
              ...detail.contribution,
              updatedAt: createdAt,
            },
            attachments: asArray(detail.attachments),
            fallbackAcceptanceCriteria: buildAcceptanceCriteria({
              contribution: detail.contribution,
              attachments: asArray(detail.attachments),
              revisionNote: validation.value.body,
            }),
            fallbackNonGoals: buildNonGoals(detail.contribution),
            messages: nextConversation,
          }));
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    if (nextTurn.action === 'draft_spec') {
      const versionNumber = (getLatestSpecVersion(detail.specVersions)?.versionNumber ?? 0) + 1;
      const specVersion = buildSpecVersionRecord({
        id: idFactory(),
        contribution: {
          ...detail.contribution,
          updatedAt: createdAt,
        },
        versionNumber,
        attachments: asArray(detail.attachments),
        createdAt,
        generatedSpec: nextTurn,
      });
      const agentMessage = createAgentMessage({
        id: idFactory(),
        contributionId,
        body: nextTurn.assistantMessage,
        createdAt,
        metadata: {
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
          ...nextTurn.metadata,
        },
      });
      const specEvent = {
        id: idFactory(),
        contributionId,
        kind: GENERATED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        message: `Spec v${specVersion.versionNumber} ready for approval.`,
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: specVersion.id,
          versionNumber: specVersion.versionNumber,
        },
        createdAt,
      };

      const updated = await database.applyContributionUpdate({
        contributionId,
        nextState: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
        updatedAt: createdAt,
        messages: [requesterMessage, agentMessage],
        specVersions: [specVersion],
        progressEvents: [specEvent],
      });

      return buildResponse(200, buildContributionSnapshot(updated));
    }

    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: nextTurn.assistantMessage,
      createdAt,
      messageType: 'ask_user_questions',
      choices: nextTurn.questions,
      metadata: {
        questionCount: Array.isArray(nextTurn.questions) ? nextTurn.questions.length : 0,
        ...nextTurn.metadata,
      },
    });
    const clarificationEvent = {
      id: idFactory(),
      contributionId,
      kind: CLARIFICATION_REQUESTED_PROGRESS_EVENT_KIND,
      status: INITIAL_CONTRIBUTION_STATE,
      message: 'More clarification is needed.',
      externalUrl: null,
      payload: {
        contributionId,
        questionCount: Array.isArray(nextTurn.questions) ? nextTurn.questions.length : 0,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: INITIAL_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [requesterMessage, agentMessage],
      progressEvents: [clarificationEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createContributionAttachmentHandler() {
  return () =>
    notWiredResponse('Binary attachment upload is not wired yet. Attachment metadata is captured during contribution creation.');
}

export function createSpecApprovalHandler({
  database,
  specService = createConfiguredSpecService(),
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateSpecApprovalPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_spec_approval_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Spec approval persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const latestSpec = getLatestSpecVersion(detail.specVersions);

    if (!latestSpec) {
      return buildResponse(409, {
        error: 'spec_not_ready',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();

    if (validation.value.decision === 'approve') {
      const requesterMessage = createUserMessage({
        id: idFactory(),
        contributionId,
        body: validation.value.note
          ? `Spec approved. Note: ${validation.value.note}`
          : 'Spec approved.',
        createdAt,
        messageType: 'spec_approval',
      });
      const progressEvent = {
        id: idFactory(),
        contributionId,
        kind: APPROVED_SPEC_PROGRESS_EVENT_KIND,
        status: SPEC_APPROVED_CONTRIBUTION_STATE,
        message: `Spec v${latestSpec.versionNumber} approved.`,
        externalUrl: null,
        payload: {
          contributionId,
          specVersionId: latestSpec.id,
          versionNumber: latestSpec.versionNumber,
        },
        createdAt,
      };
      const updated = await database.applyContributionUpdate({
        contributionId,
        nextState: SPEC_APPROVED_CONTRIBUTION_STATE,
        updatedAt: createdAt,
        messages: [requesterMessage],
        specVersions: [],
        progressEvents: [progressEvent],
        approvedSpecVersionId: latestSpec.id,
        approvedAt: createdAt,
      });

      return buildResponse(200, buildContributionSnapshot(updated));
    }

    const refinementNote = validation.value.note ?? 'Please revise the spec.';
    let refinedSpec;
    try {
      refinedSpec = await specService.refineSpec({
        contribution: {
          ...detail.contribution,
          updatedAt: createdAt,
        },
        attachments: asArray(detail.attachments),
        currentSpec: latestSpec,
        refinementNote,
        fallbackAcceptanceCriteria: buildAcceptanceCriteria({
          contribution: detail.contribution,
          attachments: asArray(detail.attachments),
          revisionNote: refinementNote,
        }),
        fallbackNonGoals: buildNonGoals(detail.contribution),
        messages: asArray(detail.messages),
      });
    } catch (error) {
      return specServiceErrorResponse(error);
    }

    const nextSpecVersion = buildSpecVersionRecord({
      id: idFactory(),
      contribution: {
        ...detail.contribution,
        updatedAt: createdAt,
      },
      versionNumber: latestSpec.versionNumber + 1,
      attachments: asArray(detail.attachments),
      createdAt,
      revisionNote: refinementNote,
      generatedSpec: refinedSpec,
    });
    const requesterMessage = createUserMessage({
      id: idFactory(),
      contributionId,
      body: refinementNote,
      createdAt,
      messageType: 'spec_refinement',
    });
    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: refinedSpec.assistantMessage,
      createdAt,
      metadata: {
        specVersionId: nextSpecVersion.id,
        versionNumber: nextSpecVersion.versionNumber,
        revisionNote: refinementNote,
        ...refinedSpec.metadata,
      },
    });
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: REFINED_SPEC_PROGRESS_EVENT_KIND,
      status: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
      message: `Spec v${nextSpecVersion.versionNumber} ready after refinement.`,
      externalUrl: null,
      payload: {
        contributionId,
        specVersionId: nextSpecVersion.id,
        versionNumber: nextSpecVersion.versionNumber,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
      updatedAt: createdAt,
      messages: [requesterMessage, agentMessage],
      specVersions: [nextSpecVersion],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createContributionProgressHandler({ database } = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionProgress')) {
      return notWiredResponse('Contribution progress persistence is not wired yet.');
    }

    const progress = await database.getContributionProgress(contributionId);

    if (!progress) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildResponse(200, {
      contributionId,
      contribution: serializeContribution(progress.contribution),
      lifecycle: {
        currentState: progress.contribution.state,
        events: asArray(progress.progressEvents).map(serializeProgressEvent),
      },
    });
  };
}

export function createQueueImplementationHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateQueueImplementationPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_queue_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Implementation queue persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (detail.contribution.state !== SPEC_APPROVED_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'contribution_not_ready_for_implementation',
        contributionId,
        state: detail.contribution.state,
      });
    }

    if (asArray(detail.implementationJobs).some((job) => job.status === 'queued' || job.status === 'running')) {
      return buildResponse(409, {
        error: 'implementation_already_queued',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();
    const implementationJob = {
      id: idFactory(),
      contributionId,
      status: 'queued',
      queueName: validation.value.queueName,
      branchName: validation.value.branchName,
      repositoryFullName: validation.value.repositoryFullName,
      githubRunId: null,
      startedAt: null,
      finishedAt: null,
      errorSummary: null,
      metadata: validation.value.note ? { note: validation.value.note } : null,
      createdAt,
    };
    const nextState = advanceContributionState(detail.contribution.state, AGENT_QUEUED_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: QUEUED_IMPLEMENTATION_PROGRESS_EVENT_KIND,
      status: nextState,
      message: 'Implementation queued.',
      externalUrl: null,
      payload: {
        contributionId,
        implementationJobId: implementationJob.id,
        queueName: implementationJob.queueName,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      implementationJobs: [implementationJob],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createPullRequestHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validatePullRequestPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_pull_request_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Pull request persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (getContributionStateIndex(detail.contribution.state) < getContributionStateIndex(SPEC_APPROVED_CONTRIBUTION_STATE)) {
      return buildResponse(409, {
        error: 'contribution_not_ready_for_pull_request',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const pullRequest = {
      id: idFactory(),
      contributionId,
      repositoryFullName: validation.value.repositoryFullName,
      number: validation.value.number,
      url: validation.value.url,
      branchName: validation.value.branchName,
      headSha: validation.value.headSha,
      status: validation.value.status,
      metadata: null,
      createdAt,
      updatedAt: createdAt,
    };
    const nextState = advanceContributionState(detail.contribution.state, PR_OPENED_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: RECORDED_PULL_REQUEST_PROGRESS_EVENT_KIND,
      status: nextState,
      message: `PR #${pullRequest.number} recorded.`,
      externalUrl: pullRequest.url,
      payload: {
        contributionId,
        pullRequestId: pullRequest.id,
        repositoryFullName: pullRequest.repositoryFullName,
        number: pullRequest.number,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      pullRequests: [pullRequest],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createPreviewDeploymentHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validatePreviewDeploymentPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_preview_deployment_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Preview deployment persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (
      validation.value.pullRequestId &&
      !asArray(detail.pullRequests).some((pullRequest) => pullRequest.id === validation.value.pullRequestId)
    ) {
      return buildResponse(400, {
        error: 'pull_request_not_found',
        contributionId,
        pullRequestId: validation.value.pullRequestId,
      });
    }

    const createdAt = clock().toISOString();
    const previewDeployment = {
      id: idFactory(),
      contributionId,
      pullRequestId: validation.value.pullRequestId,
      url: validation.value.url,
      status: validation.value.status,
      gitSha: validation.value.gitSha,
      deployKind: validation.value.deployKind,
      deployedAt: validation.value.status === 'ready' ? createdAt : null,
      checkedAt: createdAt,
      errorSummary: validation.value.errorSummary,
      metadata: null,
      createdAt,
    };
    const candidateState =
      validation.value.status === 'ready'
        ? PREVIEW_READY_CONTRIBUTION_STATE
      : validation.value.status === 'deploying'
          ? PREVIEW_DEPLOYING_CONTRIBUTION_STATE
          : PREVIEW_FAILED_CONTRIBUTION_STATE;
    const nextState = advanceContributionState(detail.contribution.state, candidateState);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: RECORDED_PREVIEW_DEPLOYMENT_PROGRESS_EVENT_KIND,
      status: nextState,
      message:
        validation.value.status === 'ready'
          ? 'Preview is ready for review.'
          : validation.value.status === 'deploying'
            ? 'Preview deployment recorded.'
            : 'Preview deployment failed.',
      externalUrl: previewDeployment.url,
      payload: {
        contributionId,
        previewDeploymentId: previewDeployment.id,
        status: previewDeployment.status,
        deployKind: previewDeployment.deployKind,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      previewDeployments: [previewDeployment],
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createOpenVotingHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Voting persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (!asArray(detail.previewDeployments).some((preview) => preview.status === 'ready')) {
      return buildResponse(409, {
        error: 'preview_not_ready',
        contributionId,
      });
    }

    if (detail.contribution.state === VOTING_OPEN_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'voting_already_open',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();
    const nextState = advanceContributionState(detail.contribution.state, VOTING_OPEN_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: OPENED_VOTING_PROGRESS_EVENT_KIND,
      status: nextState,
      message: 'Voting opened.',
      externalUrl: null,
      payload: {
        contributionId,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createVoteHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateVotePayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_vote_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Vote persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (detail.contribution.state !== VOTING_OPEN_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'voting_not_open',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const vote = {
      id: idFactory(),
      contributionId,
      voterUserId: validation.value.voterUserId,
      voterEmail: validation.value.voterEmail,
      voteType: validation.value.voteType,
      metadata: null,
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: detail.contribution.state,
      updatedAt: createdAt,
      votes: [vote],
    });

    return buildResponse(201, buildContributionSnapshot(updated));
  };
}

export function createCommentHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {}, body } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    const validation = validateCommentPayload(body);

    if (!validation.ok) {
      return buildResponse(400, {
        error: 'invalid_comment_payload',
        issues: validation.errors,
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Comment persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    if (getContributionStateIndex(detail.contribution.state) < getContributionStateIndex(SPEC_APPROVED_CONTRIBUTION_STATE)) {
      return buildResponse(409, {
        error: 'comments_not_open',
        contributionId,
        state: detail.contribution.state,
      });
    }

    const createdAt = clock().toISOString();
    const comment = {
      id: idFactory(),
      contributionId,
      authorUserId: validation.value.authorUserId,
      authorRole: validation.value.authorRole,
      body: validation.value.body,
      disposition: validation.value.disposition,
      metadata: null,
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState: detail.contribution.state,
      updatedAt: createdAt,
      comments: [comment],
    });

    return buildResponse(201, buildContributionSnapshot(updated));
  };
}

export function createMarkMergedHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {
  return async ({ params = {} } = {}) => {
    const contributionId = typeof params.id === 'string' ? params.id.trim() : '';

    if (!contributionId) {
      return buildResponse(400, {
        error: 'invalid_contribution_id',
        message: 'Contribution id is required.',
      });
    }

    if (!hasReadyPersistence(database, 'getContributionDetail') || !hasReadyPersistence(database, 'applyContributionUpdate')) {
      return notWiredResponse('Merge persistence is not wired yet.');
    }

    const detail = await database.getContributionDetail(contributionId);

    if (!detail) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    const mergedPullRequest = asArray(detail.pullRequests).find((pullRequest) => pullRequest.status === 'merged');

    if (!mergedPullRequest) {
      return buildResponse(409, {
        error: 'merged_pull_request_required',
        contributionId,
      });
    }

    if (detail.contribution.state === MERGED_CONTRIBUTION_STATE) {
      return buildResponse(409, {
        error: 'contribution_already_merged',
        contributionId,
      });
    }

    const createdAt = clock().toISOString();
    const nextState = advanceContributionState(detail.contribution.state, MERGED_CONTRIBUTION_STATE);
    const progressEvent = {
      id: idFactory(),
      contributionId,
      kind: MARKED_MERGED_PROGRESS_EVENT_KIND,
      status: nextState,
      message: `Merged from PR #${mergedPullRequest.number}.`,
      externalUrl: mergedPullRequest.url,
      payload: {
        contributionId,
        pullRequestId: mergedPullRequest.id,
        repositoryFullName: mergedPullRequest.repositoryFullName,
        number: mergedPullRequest.number,
      },
      createdAt,
    };
    const updated = await database.applyContributionUpdate({
      contributionId,
      nextState,
      updatedAt: createdAt,
      progressEvents: [progressEvent],
    });

    return buildResponse(200, buildContributionSnapshot(updated));
  };
}

export function createRouteHandlers(options = {}) {
  return {
    getHealth: createHealthHandler(options),
    getProjectPublicConfig: createProjectPublicConfigHandler(options),
    getContributions: createContributionListHandler(options),
    postContribution: createContributionHandler(options),
    getContribution: createContributionDetailHandler(options),
    postContributionAttachment: createContributionAttachmentHandler(options),
    postContributionMessage: createContributionMessageHandler(options),
    postSpecApproval: createSpecApprovalHandler(options),
    getContributionProgress: createContributionProgressHandler(options),
    postQueueImplementation: createQueueImplementationHandler(options),
    postPullRequest: createPullRequestHandler(options),
    postPreviewDeployment: createPreviewDeploymentHandler(options),
    postOpenVoting: createOpenVotingHandler(options),
    postVote: createVoteHandler(options),
    postComment: createCommentHandler(options),
    postMarkMerged: createMarkMergedHandler(options),
  };
}
