import { randomUUID } from 'node:crypto';

import {
  API_ROUTE_DEFINITIONS,
  CREATED_CONTRIBUTION_PROGRESS_EVENT_KIND,
  INITIAL_CONTRIBUTION_STATE,
  getProjectPublicConfig,
  validateContributionCreatePayload,
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

function buildContributionSnapshot(contribution, progressEvents) {
  return {
    contribution: {
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
    },
    lifecycle: {
      currentState: contribution.state,
      events: progressEvents.map(serializeProgressEvent),
    },
  };
}

function serializeContributionSummary(contribution) {
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
  return () => {
    if (!hasReadyPersistence(database, 'listContributions')) {
      return notWiredResponse('Contribution persistence is not wired yet.');
    }

    const contributions = database
      .listContributions()
      .slice()
      .sort((left, right) => {
        return String(right.createdAt).localeCompare(String(left.createdAt));
      })
      .map(serializeContributionSummary);

    return buildResponse(200, {
      contributions,
    });
  };
}

export function createContributionHandler({
  database,
  idFactory = randomUUID,
  clock = () => new Date(),
} = {}) {

  return ({ body } = {}) => {
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
    const progressEventId = idFactory();
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
    const progressEvent = {
      id: progressEventId,
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
    const persisted = database.createContribution({
      contribution,
      progressEvent,
    });

    return buildResponse(
      201,
      buildContributionSnapshot(
        persisted?.contribution ?? contribution,
        persisted?.progressEvents ?? [progressEvent],
      ),
    );
  };
}

export function createContributionAttachmentHandler() {
  return () => notWiredResponse('Attachment persistence is not wired yet.');
}

export function createSpecApprovalHandler() {
  return () => notWiredResponse('Spec approval persistence is not wired yet.');
}

export function createContributionProgressHandler({ database } = {}) {
  return ({ params = {} } = {}) => {
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

    const progress = database.getContributionProgress(contributionId);

    if (!progress) {
      return buildResponse(404, {
        error: 'contribution_not_found',
        contributionId,
      });
    }

    return buildResponse(200, {
      contributionId,
      contribution: {
        id: progress.contribution.id,
        projectSlug: progress.contribution.projectSlug,
        environment: progress.contribution.environment,
        type: progress.contribution.type,
        title: progress.contribution.title,
        body: progress.contribution.body ?? null,
        state: progress.contribution.state,
        createdAt: progress.contribution.createdAt,
        updatedAt: progress.contribution.updatedAt,
      },
      lifecycle: {
        currentState: progress.contribution.state,
        events: progress.progressEvents.map(serializeProgressEvent),
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
    postContributionAttachment: createContributionAttachmentHandler(options),
    postSpecApproval: createSpecApprovalHandler(options),
    getContributionProgress: createContributionProgressHandler(options),
  };
}
