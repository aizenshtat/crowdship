import { randomUUID } from 'node:crypto';

import {
  API_ROUTE_DEFINITIONS,
  APPROVED_SPEC_PROGRESS_EVENT_KIND,
  CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  GENERATED_SPEC_PROGRESS_EVENT_KIND,
  INITIAL_CONTRIBUTION_STATE,
  REFINED_SPEC_PROGRESS_EVENT_KIND,
  SPEC_APPROVED_CONTRIBUTION_STATE,
  SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
  getProjectPublicConfig,
  validateContributionCreatePayload,
  validateSpecApprovalPayload,
} from '../shared/contracts.js';

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

function hasReadyPersistence(database, methodName) {
  return Boolean(database && database.connected === true && typeof database[methodName] === 'function');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

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

function createAgentMessage({ id, contributionId, body, createdAt, metadata = null }) {
  return {
    id,
    contributionId,
    authorRole: 'agent',
    messageType: 'spec_ready',
    body,
    choices: null,
    metadata,
    createdAt,
  };
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
}) {
  const goal = formatSentence(
    revisionNote
      ? `Update ${contribution.title} with the latest requester refinement`
      : contribution.title,
    'Clarify the requested product change.',
  );
  const userProblem = formatSentence(
    revisionNote
      ? `${contribution.body ?? contribution.title} Latest refinement: ${revisionNote}`
      : contribution.body ?? contribution.title,
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
      acceptanceCriteria: buildAcceptanceCriteria({
        contribution,
        attachments,
        revisionNote,
      }),
      nonGoals: buildNonGoals(contribution),
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

function buildContributionSnapshot(detail) {
  const attachments = asArray(detail.attachments);
  const messages = asArray(detail.messages);
  const specVersions = asArray(detail.specVersions);
  const progressEvents = asArray(detail.progressEvents);
  const latestSpec = getLatestSpecVersion(specVersions);

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
  };
}

function serializeContributionSummary(contribution, specVersions = []) {
  const latestSpec = getLatestSpecVersion(specVersions);

  return {
    ...serializeContribution(contribution),
    latestSpecVersion: latestSpec?.versionNumber ?? null,
    specApprovedAt: latestSpec?.approvedAt ?? null,
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
      .map((detail) => serializeContributionSummary(detail.contribution, detail.specVersions));

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
      state: SPEC_PENDING_APPROVAL_CONTRIBUTION_STATE,
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
    const specVersion = buildSpecVersionRecord({
      id: idFactory(),
      contribution,
      versionNumber: 1,
      attachments,
      createdAt,
    });
    const agentMessage = createAgentMessage({
      id: idFactory(),
      contributionId,
      body: 'Spec v1 is ready for approval.',
      createdAt,
      metadata: {
        specVersionId: specVersion.id,
        versionNumber: specVersion.versionNumber,
      },
    });
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

    const persisted = await database.createContribution({
      contribution,
      attachments,
      messages: [requesterMessage, agentMessage],
      specVersions: [specVersion],
      progressEvents: [createdEvent, specEvent],
    });

    return buildResponse(201, buildContributionSnapshot(persisted));
  };
}

export function createContributionAttachmentHandler() {
  return () =>
    notWiredResponse('Binary attachment upload is not wired yet. Attachment metadata is captured during contribution creation.');
}

export function createSpecApprovalHandler({
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
      body: `Spec v${nextSpecVersion.versionNumber} is ready for approval.`,
      createdAt,
      metadata: {
        specVersionId: nextSpecVersion.id,
        versionNumber: nextSpecVersion.versionNumber,
        revisionNote: refinementNote,
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

export function createRouteHandlers(options = {}) {
  return {
    getHealth: createHealthHandler(options),
    getProjectPublicConfig: createProjectPublicConfigHandler(options),
    getContributions: createContributionListHandler(options),
    postContribution: createContributionHandler(options),
    getContribution: createContributionDetailHandler(options),
    postContributionAttachment: createContributionAttachmentHandler(options),
    postSpecApproval: createSpecApprovalHandler(options),
    getContributionProgress: createContributionProgressHandler(options),
  };
}
