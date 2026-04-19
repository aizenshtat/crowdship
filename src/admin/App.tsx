import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

type AdminSection = 'inbox' | 'settings' | 'operations';
type AdminBucket = 'attention' | 'ready' | 'active' | 'waiting' | 'done';
type ReadinessState = 'ready' | 'pending' | 'empty';

type ReadinessItem = {
  label: string;
  state: ReadinessState;
  detail: string;
};

type ContributionPayload = {
  route?: string;
  context?: {
    selectedObjectType?: string;
    selectedObjectId?: string;
    activeFilters?: Record<string, string>;
  };
};

type AttachmentRecord = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: string;
};

type MessageRecord = {
  id: string;
  authorRole: string;
  messageType: string;
  body: string;
  createdAt: string;
};

type SpecVersionRecord = {
  id: string;
  versionNumber: number;
  title: string;
  goal: string;
  userProblem: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  affectedRoute?: string | null;
  affectedContext?: ContributionPayload['context'] | null;
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    kind: string;
  }>;
  approvedAt?: string | null;
};

type ProgressEventRecord = {
  id: string;
  kind: string;
  message: string;
  status: string;
  createdAt: string;
};

type ReviewImplementationJobRecord = {
  id: string;
  status: string;
  queueName: string;
  branchName: string | null;
  repositoryFullName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorSummary: string | null;
  metadata: Record<string, unknown> | null;
};

type ReviewPullRequestRecord = {
  id: string;
  repositoryFullName: string;
  number: number;
  url: string;
  branchName: string;
  headSha: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewPreviewDeploymentRecord = {
  id: string;
  url: string;
  status: string;
  gitSha: string | null;
  deployKind: string;
  deployedAt: string | null;
  checkedAt: string | null;
  errorSummary: string | null;
  createdAt: string;
};

type ReviewVoteSummaryRecord = {
  approve: number;
  block: number;
  total: number;
};

type ReviewVoteRecord = {
  id: string;
  voteType: string;
  voterUserId: string | null;
  voterEmail: string | null;
  createdAt: string;
};

type ReviewCommentRecord = {
  id: string;
  authorRole: string;
  body: string;
  disposition: string;
  createdAt: string;
};

type ContributionSummary = {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  payload?: ContributionPayload;
  latestSpecVersion?: number | null;
  specApprovedAt?: string | null;
  latestImplementationJob?: ReviewImplementationJobRecord | null;
  latestPullRequest?: ReviewPullRequestRecord | null;
  latestPreviewDeployment?: ReviewPreviewDeploymentRecord | null;
  adminBucket?: AdminBucket;
};

type ContributionReview = {
  implementation: {
    current?: ReviewImplementationJobRecord | null;
    jobs: ReviewImplementationJobRecord[];
  };
  pullRequests: ReviewPullRequestRecord[];
  previewDeployments: ReviewPreviewDeploymentRecord[];
  votes: {
    summary: ReviewVoteSummaryRecord;
    items: ReviewVoteRecord[];
  };
  comments: ReviewCommentRecord[];
};

type ContributionDetail = {
  contribution: ContributionSummary & {
    body?: string | null;
    projectSlug: string;
    environment: string;
    type: string;
  };
  review?: ContributionReview | null;
  attachments: AttachmentRecord[];
  conversation: MessageRecord[];
  spec: {
    current: SpecVersionRecord | null;
    versions: SpecVersionRecord[];
  };
  lifecycle: {
    currentState: string;
    events: ProgressEventRecord[];
  };
};

type ReviewFormsState = {
  implementation: { repositoryFullName: string; branchName: string; queueName: string };
  pullRequest: { repositoryFullName: string; branchName: string; headSha: string };
  previewDeployment: { url: string; gitSha: string; deployKind: string };
  vote: { voteType: string; voterUserId: string; voterEmail: string };
  comment: { authorRole: string; body: string; disposition: string };
};

type ProjectSettingsRecord = {
  slug: string;
  name: string;
  widgetScriptUrl: string;
  allowedOrigins: string[];
  productionUrl: string;
  repositoryFullName: string;
  defaultBranch: string;
  previewBaseUrl: string;
  previewPathTemplate: string;
  executionMode: string;
  repoPath: string;
  previewDeployScript: string;
  implementationProfile: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type ProjectSettingsEnvelope = {
  root: Record<string, unknown>;
  wrapped: boolean;
};

type ProjectSettingsActionState = 'idle' | 'saving' | 'success' | 'error';
type EditableProjectField = Exclude<keyof ProjectSettingsRecord, 'slug' | 'allowedOrigins' | 'createdAt' | 'updatedAt'>;

const navSections: Array<{
  title: string;
  items: Array<{ id: AdminSection; label: string; blurb: string }>;
}> = [
  {
    title: 'Contribution',
    items: [{ id: 'inbox', label: 'Inbox', blurb: 'All live requests in decision order' }],
  },
  {
    title: 'Settings',
    items: [{ id: 'settings', label: 'Project settings', blurb: 'Install contract and widget config' }],
  },
  {
    title: 'Operations',
    items: [{ id: 'operations', label: 'Runtime watch', blurb: 'Queue, worker, and preview evidence' }],
  },
];

const DEFAULT_PROJECT_SLUG = 'example';

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item) => item.length > 0);
}

function normalizeAllowedOrigins(origins: string[]) {
  return origins
    .map((origin) => origin.trim())
    .filter((origin, index, list) => origin.length > 0 && list.indexOf(origin) === index);
}

function ensureEditableAllowedOrigins(origins: string[]) {
  return origins.length > 0 ? origins : [''];
}

function createEmptyProjectSettings(projectSlug: string): ProjectSettingsRecord {
  return {
    slug: projectSlug,
    name: '',
    widgetScriptUrl: '',
    allowedOrigins: [''],
    productionUrl: '',
    repositoryFullName: '',
    defaultBranch: '',
    previewBaseUrl: '',
    previewPathTemplate: '',
    executionMode: '',
    repoPath: '',
    previewDeployScript: '',
    implementationProfile: '',
    createdAt: null,
    updatedAt: null,
  };
}

function parseProjectSettingsResponse(
  value: unknown,
  fallbackSlug: string,
): { envelope: ProjectSettingsEnvelope; project: ProjectSettingsRecord } {
  const root = asObject(value);
  const wrappedProject = asObject(root.project);
  const wrapped = Object.keys(wrappedProject).length > 0;
  const source = wrapped ? wrappedProject : root;
  const publicConfig = asObject(source.publicConfig);
  const runtimeConfig = asObject(source.runtimeConfig);
  const repository = asObject(source.repository);
  const preview = asObject(source.preview);
  const automation = asObject(source.automation);
  const sourceAllowedOrigins = readStringList(source.allowedOrigins);
  const publicAllowedOrigins = readStringList(publicConfig.allowedOrigins);

  return {
    envelope: {
      root,
      wrapped,
    },
    project: {
      slug: readStringValue(source.slug) || fallbackSlug,
      name: readStringValue(source.name),
      widgetScriptUrl: readStringValue(source.widgetScriptUrl) || readStringValue(publicConfig.widgetScriptUrl),
      allowedOrigins: ensureEditableAllowedOrigins(
        sourceAllowedOrigins.length > 0 ? sourceAllowedOrigins : publicAllowedOrigins,
      ),
      productionUrl:
        readStringValue(source.productionUrl) ||
        readStringValue(publicConfig.productionUrl) ||
        readStringValue(runtimeConfig.productionBaseUrl),
      repositoryFullName:
        readStringValue(source.repositoryFullName) ||
        readStringValue(repository.fullName) ||
        readStringValue(runtimeConfig.repositoryFullName),
      defaultBranch:
        readStringValue(source.defaultBranch) ||
        readStringValue(repository.defaultBranch) ||
        readStringValue(runtimeConfig.defaultBranch),
      previewBaseUrl:
        readStringValue(source.previewBaseUrl) ||
        readStringValue(source.previewBase) ||
        readStringValue(runtimeConfig.previewBaseUrl) ||
        readStringValue(preview.baseUrl) ||
        readStringValue(preview.base),
      previewPathTemplate:
        readStringValue(source.previewPathTemplate) ||
        readStringValue(source.previewTemplate) ||
        readStringValue(runtimeConfig.previewUrlPattern) ||
        readStringValue(preview.pathTemplate) ||
        readStringValue(preview.template),
      executionMode:
        readStringValue(source.executionMode) ||
        readStringValue(runtimeConfig.executionMode) ||
        readStringValue(automation.executionMode),
      repoPath:
        readStringValue(source.repoPath) ||
        readStringValue(runtimeConfig.repoPath) ||
        readStringValue(repository.repoPath) ||
        readStringValue(repository.path),
      previewDeployScript:
        readStringValue(source.previewDeployScript) ||
        readStringValue(runtimeConfig.previewDeployScript) ||
        readStringValue(preview.deployScript) ||
        readStringValue(automation.previewDeployScript),
      implementationProfile:
        readStringValue(source.implementationProfile) ||
        readStringValue(runtimeConfig.implementationProfile) ||
        readStringValue(automation.implementationProfile),
      createdAt: readStringValue(source.createdAt) || null,
      updatedAt: readStringValue(source.updatedAt) || null,
    },
  };
}

function buildProjectSettingsPayload(envelope: ProjectSettingsEnvelope | null, project: ProjectSettingsRecord) {
  const root = structuredClone(envelope?.root ?? {});
  const target = envelope?.wrapped ? asObject(root.project) : root;
  const publicConfig = asObject(target.publicConfig);
  const runtimeConfig = asObject(target.runtimeConfig);
  const allowedOrigins = normalizeAllowedOrigins(project.allowedOrigins);
  const name = project.name.trim();
  const widgetScriptUrl = project.widgetScriptUrl.trim();
  const productionUrl = project.productionUrl.trim();
  const repositoryFullName = project.repositoryFullName.trim();
  const defaultBranch = project.defaultBranch.trim();
  const previewBaseUrl = project.previewBaseUrl.trim();
  const previewPathTemplate = project.previewPathTemplate.trim();
  const executionMode = project.executionMode.trim();
  const repoPath = project.repoPath.trim();
  const previewDeployScript = project.previewDeployScript.trim();
  const implementationProfile = project.implementationProfile.trim();

  target.slug = project.slug;
  target.name = name;
  target.allowedOrigins = allowedOrigins;
  target.publicConfig = {
    ...publicConfig,
    project: project.slug,
    widgetScriptUrl,
    allowedOrigins,
  };
  target.runtimeConfig = {
    ...runtimeConfig,
    executionMode,
    repositoryFullName,
    repoPath,
    defaultBranch,
    previewDeployScript,
    previewBaseUrl,
    previewUrlPattern: previewPathTemplate,
    productionBaseUrl: productionUrl,
    implementationProfile,
  };

  if (envelope?.wrapped) {
    root.project = target;
    return root;
  }

  return target;
}

function serializeProjectSettings(project: ProjectSettingsRecord) {
  return JSON.stringify({
    ...project,
    allowedOrigins: normalizeAllowedOrigins(project.allowedOrigins),
    createdAt: null,
    updatedAt: null,
  });
}

function buildInstallSnippet(project: ProjectSettingsRecord) {
  const projectSlug = project.slug.trim() || DEFAULT_PROJECT_SLUG;
  const widgetScriptUrl = project.widgetScriptUrl.trim() || 'https://crowdship.example/widget/v1.js';

  return `<script
  async
  src="${widgetScriptUrl}"
  data-crowdship-project="${projectSlug}"
  data-crowdship-environment="production"
  data-crowdship-launcher="manual"
  data-crowdship-user-id="customer-123"
  data-crowdship-user-email="customer@example.com"
  data-crowdship-user-role="customer"
></script>`;
}

async function readApiError(response: Response, fallbackMessage: string) {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };

    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }

    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore malformed error bodies and fall back to the status code.
  }

  return `${fallbackMessage} (${response.status})`;
}

async function readJsonBody(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  return JSON.parse(text) as unknown;
}

function statusLabel(state: ReadinessState) {
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'pending':
      return 'Pending';
    case 'empty':
      return 'Empty';
  }
}

function contributionStateLabel(state: string) {
  switch (state) {
    case 'spec_pending_approval':
      return 'Spec ready';
    case 'spec_approved':
      return 'Spec approved';
    case 'agent_queued':
      return 'Queued';
    case 'agent_running':
      return 'Running';
    case 'implementation_failed':
      return 'Implementation failed';
    case 'preview_deploying':
      return 'Preview deploying';
    case 'preview_failed':
      return 'Preview failed';
    case 'preview_ready':
      return 'Preview ready';
    case 'voting_open':
      return 'Voting open';
    default:
      return state.replace(/_/g, ' ');
  }
}

function contributionStateClassName(state: string) {
  switch (state) {
    case 'implementation_failed':
    case 'preview_failed':
      return 'pill-error';
    case 'preview_ready':
    case 'spec_approved':
    case 'merged':
      return 'pill-ready';
    case 'agent_queued':
    case 'agent_running':
    case 'preview_deploying':
    case 'spec_pending_approval':
      return 'pill-pending';
    default:
      return 'pill-neutral';
  }
}

function bucketLabel(bucket: AdminBucket) {
  switch (bucket) {
    case 'attention':
      return 'Needs action';
    case 'ready':
      return 'Ready';
    case 'active':
      return 'In motion';
    case 'waiting':
      return 'Waiting';
    case 'done':
      return 'Closed';
  }
}

function bucketClassName(bucket: AdminBucket) {
  switch (bucket) {
    case 'attention':
      return 'pill-error';
    case 'ready':
      return 'pill-ready';
    case 'active':
      return 'pill-pending';
    case 'waiting':
    case 'done':
      return 'pill-neutral';
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return (
    date.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }) + ' UTC'
  );
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes)) {
    return 'Unknown size';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatShortSha(value: string | null | undefined) {
  if (!value) {
    return 'Not available';
  }

  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function formatJson(value: unknown) {
  if (value == null) {
    return 'No metadata';
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return 'Unrenderable metadata';
  }
}

function reviewPillClassName(status: string) {
  const normalized = status.toLowerCase();

  if (
    normalized.includes('success') ||
    normalized.includes('complete') ||
    normalized.includes('done') ||
    normalized.includes('approve') ||
    normalized.includes('deployed') ||
    normalized.includes('open') ||
    normalized.includes('ready') ||
    normalized.includes('merged')
  ) {
    return 'pill-ready';
  }

  if (
    normalized.includes('queue') ||
    normalized.includes('pending') ||
    normalized.includes('running') ||
    normalized.includes('active') ||
    normalized.includes('review') ||
    normalized.includes('deploying')
  ) {
    return 'pill-pending';
  }

  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('block') ||
    normalized.includes('cancel')
  ) {
    return 'pill-error';
  }

  return 'pill-neutral';
}

function reviewStatusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function describeContext(payload?: ContributionPayload) {
  const contextParts = [];
  const context = payload?.context;

  if (context?.selectedObjectType || context?.selectedObjectId) {
    contextParts.push([context.selectedObjectType, context.selectedObjectId].filter(Boolean).join(' '));
  }

  if (context?.activeFilters && Object.keys(context.activeFilters).length > 0) {
    contextParts.push(
      Object.entries(context.activeFilters)
        .map(([key, value]) => `${key} ${value}`)
        .join(', '),
    );
  }

  return {
    route: payload?.route ?? 'Not provided',
    context: contextParts.join(', ') || 'No additional context',
  };
}

function defaultRepositoryFullName(projectSlug: string) {
  if (projectSlug === 'example') {
    return 'aizenshtat/example';
  }

  return '';
}

function slugifySegment(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildDefaultBranchName(contributionId: string, title: string) {
  const slug = slugifySegment(title) || 'contribution';
  return `crowdship/${contributionId}-${slug}`.slice(0, 120);
}

function getContributionBucket(item: ContributionSummary): AdminBucket {
  if (item.adminBucket) {
    return item.adminBucket;
  }

  if (
    item.state === 'implementation_failed' ||
    item.state === 'revision_requested' ||
    item.state === 'preview_failed' ||
    item.latestImplementationJob?.status === 'failed' ||
    item.latestPreviewDeployment?.status === 'failed'
  ) {
    return 'attention';
  }

  if (item.state === 'merged' || item.state === 'completed' || item.state === 'rejected') {
    return 'done';
  }

  if (
    item.state === 'spec_approved' ||
    item.state === 'preview_ready' ||
    item.state === 'requester_review' ||
    item.state === 'ready_for_voting' ||
    item.state === 'voting_open' ||
    item.state === 'core_team_flagged' ||
    item.state === 'core_review'
  ) {
    return 'ready';
  }

  if (
    item.state === 'agent_queued' ||
    item.state === 'agent_running' ||
    item.state === 'pr_opened' ||
    item.state === 'preview_deploying' ||
    item.latestImplementationJob?.status === 'queued' ||
    item.latestImplementationJob?.status === 'running' ||
    item.latestPreviewDeployment?.status === 'deploying'
  ) {
    return 'active';
  }

  return 'waiting';
}

function bucketPriority(bucket: AdminBucket) {
  switch (bucket) {
    case 'attention':
      return 0;
    case 'ready':
      return 1;
    case 'active':
      return 2;
    case 'waiting':
      return 3;
    case 'done':
      return 4;
  }
}

function getLatestImplementationJob(review?: ContributionReview | null) {
  return review?.implementation.jobs.at(-1) ?? review?.implementation.current ?? null;
}

function getLatestPullRequest(review?: ContributionReview | null) {
  return review?.pullRequests.at(-1) ?? null;
}

function getLatestPreviewDeployment(review?: ContributionReview | null) {
  return review?.previewDeployments.at(-1) ?? null;
}

function getImplementationMetadata(job?: ReviewImplementationJobRecord | null) {
  return asObject(job?.metadata);
}

function getImplementationRuntimeConfig(job?: ReviewImplementationJobRecord | null) {
  return asObject(getImplementationMetadata(job).projectRuntimeConfig);
}

function getImplementationVerification(job?: ReviewImplementationJobRecord | null) {
  return readStringList(getImplementationMetadata(job).verification);
}

function canQueueImplementation(detail: ContributionDetail) {
  return ['spec_approved', 'revision_requested', 'implementation_failed', 'preview_failed'].includes(detail.contribution.state);
}

function canOpenVoting(detail: ContributionDetail) {
  return detail.contribution.state === 'ready_for_voting';
}

function canMarkMerged(detail: ContributionDetail) {
  if (detail.contribution.state === 'merged') {
    return false;
  }

  return detail.review?.pullRequests.some((pullRequest) => pullRequest.status === 'merged') ?? false;
}

function CopyButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  return (
    <button
      className="copy-button"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopyState('copied');
          window.setTimeout(() => setCopyState('idle'), 1600);
        } catch {
          setCopyState('error');
          window.setTimeout(() => setCopyState('idle'), 1600);
        }
      }}
      aria-live="polite"
    >
      {copyState === 'copied' ? 'Snippet copied' : copyState === 'error' ? 'Copy failed' : 'Copy install snippet'}
    </button>
  );
}

function ReadinessPill({ state }: { state: ReadinessState }) {
  return <span className={`pill pill-${state}`}>{statusLabel(state)}</span>;
}

function StatePill({ state }: { state: string }) {
  return <span className={`pill ${contributionStateClassName(state)}`}>{contributionStateLabel(state)}</span>;
}

function BucketPill({ bucket }: { bucket: AdminBucket }) {
  return <span className={`pill ${bucketClassName(bucket)}`}>{bucketLabel(bucket)}</span>;
}

function SettingsView({
  settingsStatus,
  settingsError,
  savedProjectSettings,
  projectDraft,
  projectActionState,
  projectActionMessage,
  isProjectDirty,
  installSnippet,
  onFieldChange,
  onAllowedOriginChange,
  onAddAllowedOrigin,
  onRemoveAllowedOrigin,
  onResetDraft,
  onRetry,
  onSubmit,
}: {
  settingsStatus: 'loading' | 'ready' | 'error';
  settingsError: string;
  savedProjectSettings: ProjectSettingsRecord | null;
  projectDraft: ProjectSettingsRecord;
  projectActionState: ProjectSettingsActionState;
  projectActionMessage: string;
  isProjectDirty: boolean;
  installSnippet: string;
  onFieldChange: (field: EditableProjectField, value: string) => void;
  onAllowedOriginChange: (index: number, value: string) => void;
  onAddAllowedOrigin: () => void;
  onRemoveAllowedOrigin: (index: number) => void;
  onResetDraft: () => void;
  onRetry: () => void;
  onSubmit: () => void;
}) {
  const settingsPillState: ReadinessState =
    settingsStatus === 'error' ? 'empty' : settingsStatus === 'ready' && !isProjectDirty ? 'ready' : 'pending';
  const bannerClassName =
    projectActionState === 'saving'
      ? 'review-action-banner review-action-banner-loading'
      : projectActionState === 'success'
        ? 'review-action-banner review-action-banner-success'
        : projectActionState === 'error'
          ? 'review-action-banner review-action-banner-error'
          : 'review-action-banner';
  const bannerMessage =
    projectActionState === 'idle'
      ? settingsStatus === 'loading'
        ? 'Loading the saved project contract.'
        : settingsStatus === 'error'
          ? 'The saved project contract did not load cleanly.'
          : isProjectDirty
            ? 'Draft changes stay local until you publish them.'
            : 'The settings below match the saved project record.'
      : projectActionMessage;

  if (settingsStatus === 'loading' && !savedProjectSettings) {
    return (
      <section className="section-stack">
        <section className="surface-section">
          <div className="empty-state">Loading project settings.</div>
        </section>
      </section>
    );
  }

  if (settingsStatus === 'error' && !savedProjectSettings) {
    return (
      <section className="section-stack">
        <section className="surface-section">
          <div className="section-heading">
            <div>
              <h2>Project settings</h2>
              <p>Owner-controlled install contract for the target app.</p>
            </div>
          </div>
          <div className="empty-state">Could not load project settings: {settingsError}</div>
          <div className="review-form-actions" style={{ marginTop: 12 }}>
            <button className="secondary-button" type="button" onClick={onRetry}>
              Retry load
            </button>
          </div>
        </section>
      </section>
    );
  }

  return (
    <form
      className="section-stack"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Project settings</h2>
            <p>Owner-controlled install contract for the target app.</p>
          </div>
          <ReadinessPill state={settingsPillState} />
        </div>
        <div aria-live="polite" className={bannerClassName}>
          {bannerMessage}
        </div>
        <dl className="definition-list" style={{ marginTop: 12 }}>
          <div className="definition-row">
            <dt>Project</dt>
            <dd>{projectDraft.slug}</dd>
          </div>
          <div className="definition-row">
            <dt>Updated</dt>
            <dd>{savedProjectSettings?.updatedAt ? formatTimestamp(savedProjectSettings.updatedAt) : 'Not available'}</dd>
          </div>
          <div className="definition-row">
            <dt>Created</dt>
            <dd>{savedProjectSettings?.createdAt ? formatTimestamp(savedProjectSettings.createdAt) : 'Not available'}</dd>
          </div>
        </dl>
      </section>

      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Install contract</h2>
            <p>Stored values for the widget bootstrap and the production target.</p>
          </div>
        </div>
        <div className="review-form-grid review-form-grid-three">
          <label className="review-field">
            <span>Project name</span>
            <input value={projectDraft.name} onChange={(event) => onFieldChange('name', event.target.value)} />
          </label>
          <label className="review-field">
            <span>Widget script URL</span>
            <input
              value={projectDraft.widgetScriptUrl}
              onChange={(event) => onFieldChange('widgetScriptUrl', event.target.value)}
            />
          </label>
          <label className="review-field">
            <span>Production URL</span>
            <input value={projectDraft.productionUrl} onChange={(event) => onFieldChange('productionUrl', event.target.value)} />
          </label>
        </div>
      </section>

      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Allowed origins</h2>
            <p>Origins that can open the widget for this project.</p>
          </div>
        </div>
        <ul className="origin-list">
          {projectDraft.allowedOrigins.map((origin, index) => (
            <li className="origin-row" key={`${index}-${origin}`}>
              <label className="review-field" style={{ flex: 1 }}>
                <span>{`Origin ${index + 1}`}</span>
                <input value={origin} onChange={(event) => onAllowedOriginChange(index, event.target.value)} />
              </label>
              <button
                className="secondary-button"
                type="button"
                disabled={projectDraft.allowedOrigins.length === 1}
                onClick={() => onRemoveAllowedOrigin(index)}
              >
                Remove origin
              </button>
            </li>
          ))}
        </ul>
        <div className="review-form-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <button className="secondary-button" type="button" onClick={onAddAllowedOrigin}>
            Add origin
          </button>
        </div>
      </section>

      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Automation</h2>
            <p>Repository, preview, and implementation defaults for the worker path.</p>
          </div>
        </div>
        <div className="review-form-grid review-form-grid-three">
          <label className="review-field">
            <span>Repository full name</span>
            <input
              value={projectDraft.repositoryFullName}
              onChange={(event) => onFieldChange('repositoryFullName', event.target.value)}
            />
          </label>
          <label className="review-field">
            <span>Default branch</span>
            <input value={projectDraft.defaultBranch} onChange={(event) => onFieldChange('defaultBranch', event.target.value)} />
          </label>
          <label className="review-field">
            <span>Execution mode</span>
            <input value={projectDraft.executionMode} onChange={(event) => onFieldChange('executionMode', event.target.value)} />
          </label>
          <label className="review-field">
            <span>Preview base URL</span>
            <input value={projectDraft.previewBaseUrl} onChange={(event) => onFieldChange('previewBaseUrl', event.target.value)} />
          </label>
          <label className="review-field">
            <span>Preview template</span>
            <input
              value={projectDraft.previewPathTemplate}
              onChange={(event) => onFieldChange('previewPathTemplate', event.target.value)}
            />
          </label>
          <label className="review-field">
            <span>Implementation profile</span>
            <input
              value={projectDraft.implementationProfile}
              onChange={(event) => onFieldChange('implementationProfile', event.target.value)}
            />
          </label>
          <label className="review-field review-field-wide">
            <span>Repository path</span>
            <input value={projectDraft.repoPath} onChange={(event) => onFieldChange('repoPath', event.target.value)} />
          </label>
          <label className="review-field review-field-wide">
            <span>Preview deploy script</span>
            <input
              value={projectDraft.previewDeployScript}
              onChange={(event) => onFieldChange('previewDeployScript', event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Widget install snippet</h2>
            <p>The snippet below is generated from the current saved record.</p>
          </div>
          <ReadinessPill state={savedProjectSettings ? (isProjectDirty ? 'pending' : 'ready') : 'empty'} />
        </div>
        {savedProjectSettings ? (
          <div className="snippet-shell">
            <div className="snippet-actions">
              <CopyButton text={installSnippet} />
            </div>
            <pre className="snippet-code">
              <code>{installSnippet}</code>
            </pre>
          </div>
        ) : (
          <div className="empty-state compact">Load the project record before copying the install snippet.</div>
        )}
      </section>

      <section className="surface-section">
        <div className="review-form-actions" style={{ gap: 8 }}>
          <button
            className="secondary-button"
            type="button"
            disabled={!savedProjectSettings || !isProjectDirty || projectActionState === 'saving'}
            onClick={onResetDraft}
          >
            Reset draft
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={settingsStatus !== 'ready' || !savedProjectSettings || !isProjectDirty || projectActionState === 'saving'}
          >
            {projectActionState === 'saving' ? 'Publishing…' : 'Publish settings'}
          </button>
        </div>
      </section>
    </form>
  );
}

function ContributionRow({
  item,
  selected,
  onOpen,
}: {
  item: ContributionSummary;
  selected: boolean;
  onOpen: (contributionId: string) => void;
}) {
  const bucket = getContributionBucket(item);
  const { route, context } = describeContext(item.payload);
  const latestFailure = item.latestPreviewDeployment?.errorSummary ?? item.latestImplementationJob?.errorSummary ?? '';
  const latestSignal =
    item.latestPreviewDeployment?.status
      ? `Preview ${reviewStatusLabel(item.latestPreviewDeployment.status)}`
      : item.latestImplementationJob?.status
        ? `Worker ${reviewStatusLabel(item.latestImplementationJob.status)}`
        : item.latestPullRequest?.status
          ? `PR ${reviewStatusLabel(item.latestPullRequest.status)}`
          : contributionStateLabel(item.state);

  return (
    <li className="row-item">
      <button
        className={`contribution-row${selected ? ' contribution-row-selected' : ''}`}
        type="button"
        onClick={() => onOpen(item.id)}
      >
        <div className="contribution-row-main">
          <div className="contribution-row-heading">
            <div>
              <div className="row-kicker">Contribution</div>
              <h3>{item.title}</h3>
            </div>
            <div className="row-pills">
              <BucketPill bucket={bucket} />
              <StatePill state={item.state} />
            </div>
          </div>
          <div className="contribution-row-meta">
            <span>Route {route}</span>
            <span>Context {context}</span>
            <span>{latestSignal}</span>
            <span>Updated {formatTimestamp(item.updatedAt)}</span>
          </div>
          {latestFailure ? <div className="row-alert">{latestFailure}</div> : null}
        </div>
        <span className="row-open-label">{selected ? 'Open' : 'Review'}</span>
      </button>
    </li>
  );
}

function InboxSection({
  title,
  note,
  items,
  selectedContributionId,
  onOpen,
  emptyLabel,
}: {
  title: string;
  note: string;
  items: ContributionSummary[];
  selectedContributionId: string | null;
  onOpen: (contributionId: string) => void;
  emptyLabel: string;
}) {
  return (
    <section className="surface-section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <p>{note}</p>
        </div>
        <span className="section-count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">{emptyLabel}</div>
      ) : (
        <ul className="row-list">
          {items.map((item) => (
            <ContributionRow
              item={item}
              key={item.id}
              selected={item.id === selectedContributionId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function OperationsView({
  readiness,
  attentionItems,
  activeItems,
  onOpenContribution,
  selectedContributionId,
}: {
  readiness: ReadinessItem[];
  attentionItems: ContributionSummary[];
  activeItems: ContributionSummary[];
  onOpenContribution: (contributionId: string) => void;
  selectedContributionId: string | null;
}) {
  return (
    <section className="section-stack">
      <section className="surface-section">
        <div className="section-heading">
          <div>
            <h2>Runtime readiness</h2>
            <p>Real shell state only.</p>
          </div>
        </div>
        <ul className="status-list">
          {readiness.map((item) => (
            <li className="status-row" key={item.label}>
              <div className="status-copy">
                <div className="status-label">{item.label}</div>
                <div className="status-detail">{item.detail}</div>
              </div>
              <ReadinessPill state={item.state} />
            </li>
          ))}
        </ul>
      </section>

      <InboxSection
        title="Needs attention"
        note="Failed worker or preview records stay here until a newer attempt supersedes them."
        items={attentionItems}
        selectedContributionId={selectedContributionId}
        onOpen={onOpenContribution}
        emptyLabel="No delivery issue is active."
      />

      <InboxSection
        title="In motion"
        note="Queue, worker, pull request, and preview activity."
        items={activeItems}
        selectedContributionId={selectedContributionId}
        onOpen={onOpenContribution}
        emptyLabel="No contribution is moving through delivery right now."
      />
    </section>
  );
}

function ContributionDetailDrawer({
  selectedSummary,
  detail,
  detailStatus,
  detailError,
  onClose,
  onQueueImplementation,
  onOpenVoting,
  onMarkMerged,
  reviewActionState,
  reviewActionMessage,
  reviewForms,
  setReviewForms,
  submitReviewAction,
}: {
  selectedSummary: ContributionSummary | null;
  detail: ContributionDetail | null;
  detailStatus: 'idle' | 'loading' | 'ready' | 'error';
  detailError: string;
  onClose: () => void;
  onQueueImplementation: () => void;
  onOpenVoting: () => void;
  onMarkMerged: () => void;
  reviewActionState: 'idle' | 'loading' | 'error' | 'success';
  reviewActionMessage: string;
  reviewForms: ReviewFormsState;
  setReviewForms: Dispatch<SetStateAction<ReviewFormsState>>;
  submitReviewAction: (path: string, body: Record<string, string>, successMessage: string) => Promise<void>;
}) {
  const selectedContext = selectedSummary ? describeContext(selectedSummary.payload) : null;
  const detailContext = detail ? describeContext(detail.contribution.payload) : null;
  const review = detail?.review ?? null;
  const latestImplementationJob = getLatestImplementationJob(review);
  const latestPullRequest = getLatestPullRequest(review);
  const latestPreviewDeployment = getLatestPreviewDeployment(review);
  const voteSummary = review?.votes.summary ?? { approve: 0, block: 0, total: 0 };
  const implementationMetadata = getImplementationMetadata(latestImplementationJob);
  const runtimeConfig = getImplementationRuntimeConfig(latestImplementationJob);
  const verificationCommands = getImplementationVerification(latestImplementationJob);
  const workerBranchName =
    readStringValue(implementationMetadata.branchName) || latestImplementationJob?.branchName || 'Branch pending';
  const targetRepository =
    readStringValue(runtimeConfig.repositoryFullName) ||
    latestImplementationJob?.repositoryFullName ||
    'Repository default';
  const previewEvidenceUrl =
    latestPreviewDeployment?.url || readStringValue(implementationMetadata.previewUrl) || null;
  const executionMode = readStringValue(runtimeConfig.executionMode);
  const implementationProfile = readStringValue(runtimeConfig.implementationProfile);
  const runtimeDefaultBranch = readStringValue(runtimeConfig.defaultBranch);
  const previewTemplate = readStringValue(runtimeConfig.previewUrlPattern);

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" type="button" aria-label="Close contribution detail" onClick={onClose} />
      <aside className="drawer-panel" aria-modal="true" aria-labelledby="drawer-title" role="dialog">
        <div className="drawer-header">
          <div>
            <div className="drawer-kicker">Contribution review</div>
            <h2 id="drawer-title">{detail?.contribution.title ?? selectedSummary?.title ?? 'Contribution detail'}</h2>
            <p>{detail?.contribution.body ?? 'Loading the latest requester record.'}</p>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Close review
          </button>
        </div>

        {detailStatus === 'loading' ? (
          <div className="drawer-empty">Loading contribution detail.</div>
        ) : detailStatus === 'error' ? (
          <div className="drawer-empty">Could not load contribution detail: {detailError}</div>
        ) : !detail ? (
          <div className="drawer-empty">Select a contribution to review it.</div>
        ) : (
          <>
            <div className="drawer-rail">
              <div className="drawer-rail-pills">
                <BucketPill bucket={getContributionBucket(detail.contribution)} />
                <StatePill state={detail.contribution.state} />
              </div>
              <div className="drawer-rail-links">
                {latestPullRequest ? (
                  <a href={latestPullRequest.url} rel="noreferrer" target="_blank">
                    Open PR #{latestPullRequest.number}
                  </a>
                ) : null}
                {latestPreviewDeployment?.url ? (
                  <a href={latestPreviewDeployment.url} rel="noreferrer" target="_blank">
                    Open preview
                  </a>
                ) : null}
              </div>
              <div className="drawer-rail-actions">
                {canQueueImplementation(detail) ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={reviewActionState === 'loading'}
                    onClick={onQueueImplementation}
                  >
                    {reviewActionState === 'loading' ? 'Queueing…' : 'Queue implementation'}
                  </button>
                ) : null}
                {canOpenVoting(detail) ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={reviewActionState === 'loading'}
                    onClick={onOpenVoting}
                  >
                    {reviewActionState === 'loading' ? 'Opening…' : 'Open voting'}
                  </button>
                ) : null}
                {canMarkMerged(detail) ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={reviewActionState === 'loading'}
                    onClick={onMarkMerged}
                  >
                    {reviewActionState === 'loading' ? 'Recording…' : 'Mark merged'}
                  </button>
                ) : null}
              </div>
              <div className={`review-action-banner review-action-banner-${reviewActionState}`} aria-live="polite">
                {reviewActionState === 'idle' ? 'Keep the delivery actions here. Everything else stays below.' : reviewActionMessage}
              </div>
            </div>

            <div className="drawer-content">
              <section className="drawer-section">
                <div className="drawer-section-heading">
                  <h3>Request context</h3>
                  <span className="section-note">What the requester was looking at.</span>
                </div>
                <dl className="definition-list">
                  <div className="definition-row">
                    <dt>Project</dt>
                    <dd>{detail.contribution.projectSlug}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Environment</dt>
                    <dd>{detail.contribution.environment}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Route</dt>
                    <dd>{detailContext?.route ?? selectedContext?.route ?? 'Not provided'}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Context</dt>
                    <dd>{detailContext?.context ?? selectedContext?.context ?? 'No additional context'}</dd>
                  </div>
                  <div className="definition-row">
                    <dt>Created</dt>
                    <dd>{formatTimestamp(detail.contribution.createdAt)}</dd>
                  </div>
                </dl>
              </section>

              <section className="drawer-section">
                <div className="drawer-section-heading">
                  <h3>Spec</h3>
                  <span className="section-note">
                    {detail.spec.current?.approvedAt ? `Approved ${formatTimestamp(detail.spec.current.approvedAt)}` : 'Awaiting requester approval'}
                  </span>
                </div>
                {detail.spec.current ? (
                  <div className="spec-card">
                    <div className="spec-header">
                      <div>
                        <div className="spec-version">Spec v{detail.spec.current.versionNumber}</div>
                        <h4>{detail.spec.current.title}</h4>
                      </div>
                    </div>
                    <div className="spec-block">
                      <div className="detail-label">Goal</div>
                      <p>{detail.spec.current.goal}</p>
                    </div>
                    <div className="spec-block">
                      <div className="detail-label">User problem</div>
                      <p>{detail.spec.current.userProblem}</p>
                    </div>
                    <div className="spec-columns">
                      <div className="spec-block">
                        <div className="detail-label">Acceptance criteria</div>
                        <ul className="detail-list">
                          {detail.spec.current.acceptanceCriteria.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="spec-block">
                        <div className="detail-label">Non-goals</div>
                        <ul className="detail-list">
                          {detail.spec.current.nonGoals.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state compact">No spec has been generated yet.</div>
                )}
              </section>

              <section className="drawer-section">
                <div className="drawer-section-heading">
                  <h3>Delivery</h3>
                  <span className="section-note">The current engineering handoff and review evidence.</span>
                </div>
                <div className="review-summary-strip">
                  <div className="review-summary-item">
                    <span className="review-summary-label">Worker</span>
                    <strong>{latestImplementationJob ? reviewStatusLabel(latestImplementationJob.status) : 'Not started'}</strong>
                  </div>
                  <div className="review-summary-item">
                    <span className="review-summary-label">Pull request</span>
                    <strong>{latestPullRequest ? reviewStatusLabel(latestPullRequest.status) : 'Not recorded'}</strong>
                  </div>
                  <div className="review-summary-item">
                    <span className="review-summary-label">Preview</span>
                    <strong>{latestPreviewDeployment ? reviewStatusLabel(latestPreviewDeployment.status) : 'Not recorded'}</strong>
                  </div>
                  <div className="review-summary-item">
                    <span className="review-summary-label">Votes</span>
                    <strong>
                      {voteSummary.approve} approve / {voteSummary.block} block
                    </strong>
                  </div>
                </div>

                <div className="record-grid">
                  <div className="record-card">
                    <div className="record-card-title">Latest worker run</div>
                    {latestImplementationJob ? (
                      <>
                        <div className="stack-item-head">
                          <span className="stack-item-title">{workerBranchName}</span>
                          <span className={`pill ${reviewPillClassName(latestImplementationJob.status)}`}>{reviewStatusLabel(latestImplementationJob.status)}</span>
                        </div>
                        <div className="stack-item-copy">
                          {targetRepository} / created {formatTimestamp(latestImplementationJob.createdAt)}
                        </div>
                        <div className="stack-item-copy">
                          {verificationCommands.length > 0
                            ? `${verificationCommands.length} verification step${verificationCommands.length === 1 ? '' : 's'} passed.`
                            : 'Verification has not been recorded yet.'}
                        </div>
                        {latestImplementationJob.errorSummary ? <div className="row-alert">{latestImplementationJob.errorSummary}</div> : null}
                      </>
                    ) : (
                      <div className="empty-state compact">No implementation job has been queued.</div>
                    )}
                  </div>

                  <div className="record-card">
                    <div className="record-card-title">Latest review links</div>
                    {latestPullRequest ? (
                      <div className="stack-item-copy">
                        <a href={latestPullRequest.url} rel="noreferrer" target="_blank">
                          PR #{latestPullRequest.number}
                        </a>{' '}
                        / {latestPullRequest.branchName}
                      </div>
                    ) : (
                      <div className="stack-item-copy">No pull request has been recorded.</div>
                    )}
                    {latestPreviewDeployment ? (
                      <div className="stack-item-copy">
                        <a href={latestPreviewDeployment.url} rel="noreferrer" target="_blank">
                          Preview link
                        </a>{' '}
                        / {reviewStatusLabel(latestPreviewDeployment.status)}
                      </div>
                    ) : (
                      <div className="stack-item-copy">No preview deployment has been recorded.</div>
                    )}
                  </div>

                  <div className="record-card">
                    <div className="record-card-title">Automation evidence</div>
                    <div className="stack-item-copy">
                      Target {targetRepository} / {runtimeDefaultBranch || 'default branch not recorded'}
                    </div>
                    <div className="stack-item-copy">
                      Mode {[executionMode, implementationProfile].filter(Boolean).join(' / ') || 'Automation mode not recorded.'}
                    </div>
                    <div className="stack-item-copy">
                      Verification {verificationCommands.length > 0 ? verificationCommands.join(' • ') : 'No verification commands recorded.'}
                    </div>
                    {previewEvidenceUrl ? (
                      <div className="stack-item-copy">
                        <a href={previewEvidenceUrl} rel="noreferrer" target="_blank">
                          Preview smoke target
                        </a>
                      </div>
                    ) : (
                      <div className="stack-item-copy">No preview smoke target has been recorded.</div>
                    )}
                    {previewTemplate ? <div className="stack-item-copy">Template {previewTemplate}</div> : null}
                  </div>
                </div>
              </section>

              <details className="drawer-collapsible">
                <summary>Requester conversation</summary>
                {detail.conversation.length === 0 ? (
                  <div className="empty-state compact">No requester conversation is stored yet.</div>
                ) : (
                  <ul className="detail-stack-list">
                    {detail.conversation.map((message) => (
                      <li className="stack-item" key={message.id}>
                        <div className="stack-item-head">
                          <span className="stack-item-title">{message.authorRole}</span>
                          <span className="stack-item-meta">{formatTimestamp(message.createdAt)}</span>
                        </div>
                        <div className="stack-item-copy">{message.body}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>

              <details className="drawer-collapsible">
                <summary>Attachments</summary>
                {detail.attachments.length === 0 ? (
                  <div className="empty-state compact">No attachment metadata was shared.</div>
                ) : (
                  <ul className="detail-stack-list">
                    {detail.attachments.map((attachment) => (
                      <li className="stack-item" key={attachment.id}>
                        <div className="stack-item-title">{attachment.filename}</div>
                        <div className="stack-item-copy">
                          {attachment.contentType} / {formatBytes(attachment.sizeBytes)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </details>

              <details className="drawer-collapsible">
                <summary>Manual overrides</summary>
                <div className="review-action-grid">
                  <form
                    className="review-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReviewAction(
                        `/api/v1/contributions/${detail.contribution.id}/queue-implementation`,
                        reviewForms.implementation,
                        'Implementation queued.',
                      );
                    }}
                  >
                    <div className="review-form-title">Queue implementation</div>
                    <div className="review-form-grid review-form-grid-three">
                      <label className="review-field">
                        <span>Repository</span>
                        <input
                          value={reviewForms.implementation.repositoryFullName}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              implementation: { ...current.implementation, repositoryFullName: event.target.value },
                            }))
                          }
                          placeholder="owner/repo"
                        />
                      </label>
                      <label className="review-field">
                        <span>Branch</span>
                        <input
                          value={reviewForms.implementation.branchName}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              implementation: { ...current.implementation, branchName: event.target.value },
                            }))
                          }
                          placeholder="feature/branch"
                        />
                      </label>
                      <label className="review-field">
                        <span>Queue</span>
                        <input
                          value={reviewForms.implementation.queueName}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              implementation: { ...current.implementation, queueName: event.target.value },
                            }))
                          }
                          placeholder="default"
                        />
                      </label>
                    </div>
                    <div className="review-form-actions">
                      <button className="primary-button" type="submit" disabled={reviewActionState === 'loading'}>
                        {reviewActionState === 'loading' ? 'Queueing…' : 'Queue implementation'}
                      </button>
                    </div>
                  </form>

                  <form
                    className="review-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReviewAction(
                        `/api/v1/contributions/${detail.contribution.id}/pull-requests`,
                        reviewForms.pullRequest,
                        'Pull request recorded.',
                      );
                    }}
                  >
                    <div className="review-form-title">Record pull request</div>
                    <div className="review-form-grid review-form-grid-three">
                      <label className="review-field">
                        <span>Repository</span>
                        <input
                          value={reviewForms.pullRequest.repositoryFullName}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              pullRequest: { ...current.pullRequest, repositoryFullName: event.target.value },
                            }))
                          }
                          placeholder="owner/repo"
                        />
                      </label>
                      <label className="review-field">
                        <span>Branch</span>
                        <input
                          value={reviewForms.pullRequest.branchName}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              pullRequest: { ...current.pullRequest, branchName: event.target.value },
                            }))
                          }
                          placeholder="feature/branch"
                        />
                      </label>
                      <label className="review-field">
                        <span>Head SHA</span>
                        <input
                          value={reviewForms.pullRequest.headSha}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              pullRequest: { ...current.pullRequest, headSha: event.target.value },
                            }))
                          }
                          placeholder="commit sha"
                        />
                      </label>
                    </div>
                    <div className="review-form-actions">
                      <button className="primary-button" type="submit" disabled={reviewActionState === 'loading'}>
                        {reviewActionState === 'loading' ? 'Recording…' : 'Record pull request'}
                      </button>
                    </div>
                  </form>

                  <form
                    className="review-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReviewAction(
                        `/api/v1/contributions/${detail.contribution.id}/preview-deployments`,
                        reviewForms.previewDeployment,
                        'Preview deployment recorded.',
                      );
                    }}
                  >
                    <div className="review-form-title">Record preview deployment</div>
                    <div className="review-form-grid review-form-grid-three">
                      <label className="review-field">
                        <span>URL</span>
                        <input
                          value={reviewForms.previewDeployment.url}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              previewDeployment: { ...current.previewDeployment, url: event.target.value },
                            }))
                          }
                          placeholder="https://preview.example"
                        />
                      </label>
                      <label className="review-field">
                        <span>Git SHA</span>
                        <input
                          value={reviewForms.previewDeployment.gitSha}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              previewDeployment: { ...current.previewDeployment, gitSha: event.target.value },
                            }))
                          }
                          placeholder="commit sha"
                        />
                      </label>
                      <label className="review-field">
                        <span>Kind</span>
                        <input
                          value={reviewForms.previewDeployment.deployKind}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              previewDeployment: { ...current.previewDeployment, deployKind: event.target.value },
                            }))
                          }
                          placeholder="preview"
                        />
                      </label>
                    </div>
                    <div className="review-form-actions">
                      <button className="primary-button" type="submit" disabled={reviewActionState === 'loading'}>
                        {reviewActionState === 'loading' ? 'Recording…' : 'Record deployment'}
                      </button>
                    </div>
                  </form>

                  <form
                    className="review-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReviewAction(
                        `/api/v1/contributions/${detail.contribution.id}/votes`,
                        reviewForms.vote,
                        'Vote recorded.',
                      );
                    }}
                  >
                    <div className="review-form-title">Record vote</div>
                    <div className="review-form-grid review-form-grid-three">
                      <label className="review-field">
                        <span>Vote</span>
                        <select
                          value={reviewForms.vote.voteType}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              vote: { ...current.vote, voteType: event.target.value },
                            }))
                          }
                        >
                          <option value="approve">approve</option>
                          <option value="block">block</option>
                        </select>
                      </label>
                      <label className="review-field">
                        <span>User ID</span>
                        <input
                          value={reviewForms.vote.voterUserId}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              vote: { ...current.vote, voterUserId: event.target.value },
                            }))
                          }
                          placeholder="voter user id"
                        />
                      </label>
                      <label className="review-field">
                        <span>Email</span>
                        <input
                          value={reviewForms.vote.voterEmail}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              vote: { ...current.vote, voterEmail: event.target.value },
                            }))
                          }
                          placeholder="voter@example.com"
                        />
                      </label>
                    </div>
                    <div className="review-form-actions">
                      <button className="primary-button" type="submit" disabled={reviewActionState === 'loading'}>
                        {reviewActionState === 'loading' ? 'Recording…' : 'Record vote'}
                      </button>
                    </div>
                  </form>

                  <form
                    className="review-action-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitReviewAction(
                        `/api/v1/contributions/${detail.contribution.id}/comments`,
                        reviewForms.comment,
                        'Comment recorded.',
                      );
                    }}
                  >
                    <div className="review-form-title">Add comment</div>
                    <div className="review-form-grid review-form-grid-three">
                      <label className="review-field">
                        <span>Role</span>
                        <input
                          value={reviewForms.comment.authorRole}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              comment: { ...current.comment, authorRole: event.target.value },
                            }))
                          }
                          placeholder="admin"
                        />
                      </label>
                      <label className="review-field">
                        <span>Disposition</span>
                        <input
                          value={reviewForms.comment.disposition}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              comment: { ...current.comment, disposition: event.target.value },
                            }))
                          }
                          placeholder="note"
                        />
                      </label>
                      <label className="review-field review-field-wide">
                        <span>Body</span>
                        <textarea
                          rows={3}
                          value={reviewForms.comment.body}
                          onChange={(event) =>
                            setReviewForms((current) => ({
                              ...current,
                              comment: { ...current.comment, body: event.target.value },
                            }))
                          }
                          placeholder="Write the review note."
                        />
                      </label>
                    </div>
                    <div className="review-form-actions">
                      <button className="primary-button" type="submit" disabled={reviewActionState === 'loading'}>
                        {reviewActionState === 'loading' ? 'Recording…' : 'Add comment'}
                      </button>
                    </div>
                  </form>
                </div>
              </details>

              <details className="drawer-collapsible">
                <summary>Technical timeline</summary>
                <ul className="detail-stack-list">
                  {detail.lifecycle.events.map((event) => (
                    <li className="stack-item" key={event.id}>
                      <div className="stack-item-head">
                        <span className="stack-item-title">{event.message}</span>
                        <span className="stack-item-meta">{formatTimestamp(event.createdAt)}</span>
                      </div>
                      <div className="stack-item-copy">
                        {event.kind.replace(/_/g, ' ')} / {event.status.replace(/_/g, ' ')}
                      </div>
                    </li>
                  ))}
                </ul>

                {review ? (
                  <div className="technical-grid">
                    <div>
                      <div className="record-card-title">Worker history</div>
                      {review.implementation.jobs.length === 0 ? (
                        <div className="empty-state compact">No worker history yet.</div>
                      ) : (
                        <ul className="detail-stack-list">
                          {review.implementation.jobs.map((job) => (
                            <li className="stack-item" key={job.id}>
                              <div className="stack-item-head">
                                <span className="stack-item-title">{job.branchName ?? 'Branch pending'}</span>
                                <span className={`pill ${reviewPillClassName(job.status)}`}>{reviewStatusLabel(job.status)}</span>
                              </div>
                              <div className="stack-item-copy">
                                {job.repositoryFullName ?? 'Repository default'} / created {formatTimestamp(job.createdAt)}
                              </div>
                              {job.errorSummary ? <div className="stack-item-copy">{job.errorSummary}</div> : null}
                              <div className="stack-item-copy">{formatJson(job.metadata)}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="record-card-title">Review records</div>
                      <ul className="detail-stack-list">
                        {review.pullRequests.map((pullRequest) => (
                          <li className="stack-item" key={pullRequest.id}>
                            <div className="stack-item-head">
                              <span className="stack-item-title">
                                <a href={pullRequest.url} rel="noreferrer" target="_blank">
                                  #{pullRequest.number}
                                </a>{' '}
                                / {pullRequest.branchName}
                              </span>
                              <span className={`pill ${reviewPillClassName(pullRequest.status)}`}>{reviewStatusLabel(pullRequest.status)}</span>
                            </div>
                            <div className="stack-item-copy">
                              {pullRequest.repositoryFullName} / head {formatShortSha(pullRequest.headSha)}
                            </div>
                          </li>
                        ))}
                        {review.previewDeployments.map((deployment) => (
                          <li className="stack-item" key={deployment.id}>
                            <div className="stack-item-head">
                              <span className="stack-item-title">
                                <a href={deployment.url} rel="noreferrer" target="_blank">
                                  {deployment.deployKind}
                                </a>
                              </span>
                              <span className={`pill ${reviewPillClassName(deployment.status)}`}>{reviewStatusLabel(deployment.status)}</span>
                            </div>
                            <div className="stack-item-copy">
                              sha {formatShortSha(deployment.gitSha)} / checked {formatTimestamp(deployment.checkedAt)}
                            </div>
                            {deployment.errorSummary ? <div className="stack-item-copy">{deployment.errorSummary}</div> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </details>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export function App() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim() ?? '';
  const initialContributionId =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('contribution') : null;
  const projectSettingsEndpoint = `/api/v1/projects/${encodeURIComponent(DEFAULT_PROJECT_SLUG)}`;

  const [activeSection, setActiveSection] = useState<AdminSection>('inbox');
  const [intakeQueue, setIntakeQueue] = useState<ContributionSummary[]>([]);
  const [intakeStatus, setIntakeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [intakeError, setIntakeError] = useState('');
  const [selectedContributionId, setSelectedContributionId] = useState<string | null>(initialContributionId);
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<ContributionDetail | null>(null);
  const [reviewActionState, setReviewActionState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [reviewActionMessage, setReviewActionMessage] = useState('');
  const [projectSettingsStatus, setProjectSettingsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projectSettingsError, setProjectSettingsError] = useState('');
  const [projectSettingsEnvelope, setProjectSettingsEnvelope] = useState<ProjectSettingsEnvelope | null>(null);
  const [savedProjectSettings, setSavedProjectSettings] = useState<ProjectSettingsRecord | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectSettingsRecord>(() => createEmptyProjectSettings(DEFAULT_PROJECT_SLUG));
  const [projectActionState, setProjectActionState] = useState<ProjectSettingsActionState>('idle');
  const [projectActionMessage, setProjectActionMessage] = useState('');
  const [reviewForms, setReviewForms] = useState({
    implementation: {
      repositoryFullName: '',
      branchName: '',
      queueName: 'default',
    },
    pullRequest: {
      repositoryFullName: '',
      branchName: '',
      headSha: '',
    },
    previewDeployment: {
      url: '',
      gitSha: '',
      deployKind: 'branch_preview',
    },
    vote: {
      voteType: 'approve',
      voterUserId: '',
      voterEmail: '',
    },
    comment: {
      authorRole: 'admin',
      body: '',
      disposition: 'note',
    },
  });

  const clearProjectActionFeedback = useCallback(() => {
    setProjectActionState('idle');
    setProjectActionMessage('');
  }, []);

  const loadProjectSettings = useCallback(async () => {
    setProjectSettingsStatus('loading');
    setProjectSettingsError('');

    try {
      const response = await fetch(projectSettingsEndpoint, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Project settings request failed'));
      }

      const payload = await readJsonBody(response);
      const parsed = parseProjectSettingsResponse(payload, DEFAULT_PROJECT_SLUG);

      setProjectSettingsEnvelope(parsed.envelope);
      setSavedProjectSettings(parsed.project);
      setProjectDraft(parsed.project);
      setProjectSettingsStatus('ready');
      return parsed.project;
    } catch (error) {
      setProjectSettingsStatus('error');
      setProjectSettingsError(error instanceof Error ? error.message : 'Could not load project settings.');
      return null;
    }
  }, [projectSettingsEndpoint]);

  const loadContributions = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/contributions', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Contribution intake returned ${response.status}`);
      }

      const payload = (await response.json()) as {
        contributions?: ContributionSummary[];
      };

      const nextQueue = payload.contributions ?? [];
      setIntakeQueue(nextQueue);
      setIntakeStatus('ready');
      setIntakeError('');
      setSelectedContributionId((current) => (current && nextQueue.some((item) => item.id === current) ? current : null));
    } catch (error) {
      setIntakeStatus('error');
      setIntakeError(error instanceof Error ? error.message : 'Could not load contribution intake.');
    }
  }, []);

  const refreshDetail = useCallback(
    async (contributionId: string | null = selectedContributionId) => {
      if (!contributionId) {
        return null;
      }

      setDetailStatus('loading');
      setDetailError('');

      try {
        const response = await fetch(`/api/v1/contributions/${contributionId}`, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Contribution detail returned ${response.status}`);
        }

        const payload = (await response.json()) as ContributionDetail;
        setDetail(payload);
        setDetailStatus('ready');
        return payload;
      } catch (error) {
        setDetailStatus('error');
        setDetailError(error instanceof Error ? error.message : 'Could not load contribution detail.');
        return null;
      }
    },
    [selectedContributionId],
  );

  useEffect(() => {
    void loadProjectSettings();
  }, [loadProjectSettings]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/v1/contributions', {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Contribution intake returned ${response.status}`);
        }

        const payload = (await response.json()) as {
          contributions?: ContributionSummary[];
        };

        if (cancelled) {
          return;
        }

        setIntakeQueue(payload.contributions ?? []);
        setIntakeStatus('ready');
        setIntakeError('');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIntakeStatus('error');
        setIntakeError(error instanceof Error ? error.message : 'Could not load contribution intake.');
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedContributionId) {
      setDetail(null);
      setDetailStatus('idle');
      setDetailError('');
      return;
    }

    void refreshDetail(selectedContributionId);
  }, [refreshDetail, selectedContributionId]);

  useEffect(() => {
    if (!selectedContributionId || typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('contribution', selectedContributionId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedContributionId]);

  useEffect(() => {
    if (selectedContributionId || typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (url.searchParams.has('contribution')) {
      url.searchParams.delete('contribution');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [selectedContributionId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedContributionId(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!detail) {
      return;
    }

    const latestJob = getLatestImplementationJob(detail.review);
    const latestPullRequest = getLatestPullRequest(detail.review);
    const latestPreviewDeployment = getLatestPreviewDeployment(detail.review);

    setReviewForms({
      implementation: {
        repositoryFullName: latestJob?.repositoryFullName ?? defaultRepositoryFullName(detail.contribution.projectSlug),
        branchName: latestJob?.branchName ?? buildDefaultBranchName(detail.contribution.id, detail.contribution.title),
        queueName: latestJob?.queueName ?? 'default',
      },
      pullRequest: {
        repositoryFullName: latestPullRequest?.repositoryFullName ?? defaultRepositoryFullName(detail.contribution.projectSlug),
        branchName: latestPullRequest?.branchName ?? buildDefaultBranchName(detail.contribution.id, detail.contribution.title),
        headSha: latestPullRequest?.headSha ?? '',
      },
      previewDeployment: {
        url: latestPreviewDeployment?.url ?? '',
        gitSha: latestPreviewDeployment?.gitSha ?? '',
        deployKind: latestPreviewDeployment?.deployKind ?? 'branch_preview',
      },
      vote: {
        voteType: 'approve',
        voterUserId: '',
        voterEmail: '',
      },
      comment: {
        authorRole: 'admin',
        body: '',
        disposition: 'note',
      },
    });
  }, [detail]);

  const updateProjectField = useCallback(
    (field: EditableProjectField, value: string) => {
      clearProjectActionFeedback();
      setProjectDraft((current) => ({
        ...current,
        [field]: value,
      }));
    },
    [clearProjectActionFeedback],
  );

  const updateAllowedOrigin = useCallback(
    (index: number, value: string) => {
      clearProjectActionFeedback();
      setProjectDraft((current) => ({
        ...current,
        allowedOrigins: current.allowedOrigins.map((origin, originIndex) => (originIndex === index ? value : origin)),
      }));
    },
    [clearProjectActionFeedback],
  );

  const addAllowedOrigin = useCallback(() => {
    clearProjectActionFeedback();
    setProjectDraft((current) => ({
      ...current,
      allowedOrigins: [...current.allowedOrigins, ''],
    }));
  }, [clearProjectActionFeedback]);

  const removeAllowedOrigin = useCallback(
    (index: number) => {
      clearProjectActionFeedback();
      setProjectDraft((current) => ({
        ...current,
        allowedOrigins:
          current.allowedOrigins.length === 1
            ? current.allowedOrigins
            : current.allowedOrigins.filter((_, originIndex) => originIndex !== index),
      }));
    },
    [clearProjectActionFeedback],
  );

  const resetProjectDraft = useCallback(() => {
    if (!savedProjectSettings) {
      return;
    }

    clearProjectActionFeedback();
    setProjectDraft(savedProjectSettings);
  }, [clearProjectActionFeedback, savedProjectSettings]);

  const publishProjectSettings = useCallback(async () => {
    setProjectActionState('saving');
    setProjectActionMessage('Writing the project contract.');

    try {
      const response = await fetch(projectSettingsEndpoint, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(buildProjectSettingsPayload(projectSettingsEnvelope, projectDraft)),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Project settings update failed'));
      }

      const payload = await readJsonBody(response);
      const parsed =
        payload == null
          ? {
              envelope: projectSettingsEnvelope ?? { root: {}, wrapped: false },
              project: {
                ...projectDraft,
                allowedOrigins: normalizeAllowedOrigins(projectDraft.allowedOrigins),
              },
            }
          : parseProjectSettingsResponse(payload, projectDraft.slug || DEFAULT_PROJECT_SLUG);

      setProjectSettingsEnvelope(parsed.envelope);
      setSavedProjectSettings(parsed.project);
      setProjectDraft(parsed.project);
      setProjectSettingsStatus('ready');
      setProjectSettingsError('');
      setProjectActionState('success');
      setProjectActionMessage('Project settings published.');
    } catch (error) {
      setProjectActionState('error');
      setProjectActionMessage(error instanceof Error ? error.message : 'Could not update project settings.');
    }
  }, [projectDraft, projectSettingsEndpoint, projectSettingsEnvelope]);

  async function submitReviewAction(path: string, body: Record<string, string>, successMessage: string) {
    if (!selectedContributionId) {
      return;
    }

    setReviewActionState('loading');
    setReviewActionMessage('');

    try {
      const cleanedBody = Object.fromEntries(Object.entries(body).filter(([, value]) => value.trim().length > 0));
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(cleanedBody),
      });

      if (!response.ok) {
        throw new Error(`Review action returned ${response.status}`);
      }

      setReviewActionState('success');
      setReviewActionMessage(successMessage);
      await Promise.all([refreshDetail(selectedContributionId), loadContributions()]);
    } catch (error) {
      setReviewActionState('error');
      setReviewActionMessage(error instanceof Error ? error.message : 'Could not complete review action.');
    }
  }

  const readiness = useMemo<ReadinessItem[]>(
    () => [
      {
        label: 'Admin shell',
        state: 'ready',
        detail: 'React cockpit mounted.',
      },
      {
        label: 'PWA manifest',
        state: 'ready',
        detail: 'Install metadata is linked.',
      },
      {
        label: 'Service worker',
        state: 'ready',
        detail: 'Offline shell is registered.',
      },
      {
        label: 'Sentry init hook',
        state: sentryDsn ? 'ready' : 'pending',
        detail: sentryDsn ? 'VITE_SENTRY_DSN is set.' : 'Set VITE_SENTRY_DSN to enable browser capture.',
      },
      {
        label: 'Contribution intake',
        state:
          intakeStatus === 'ready'
            ? intakeQueue.length > 0
              ? 'ready'
              : 'empty'
            : 'pending',
        detail:
          intakeStatus === 'ready'
            ? intakeQueue.length > 0
              ? `${intakeQueue.length} live request${intakeQueue.length === 1 ? '' : 's'} with real spec records.`
              : 'No live requests yet.'
            : intakeStatus === 'error'
              ? 'The intake API did not respond cleanly.'
              : 'Loading live intake from the API.',
      },
    ],
    [intakeQueue.length, intakeStatus, sentryDsn],
  );

  const sortedContributions = useMemo(
    () =>
      intakeQueue
        .slice()
        .sort((left, right) => {
          const bucketDiff = bucketPriority(getContributionBucket(left)) - bucketPriority(getContributionBucket(right));
          if (bucketDiff !== 0) {
            return bucketDiff;
          }

          return String(right.updatedAt).localeCompare(String(left.updatedAt));
        }),
    [intakeQueue],
  );

  const groupedContributions = useMemo(() => {
    return {
      attention: sortedContributions.filter((item) => getContributionBucket(item) === 'attention'),
      ready: sortedContributions.filter((item) => getContributionBucket(item) === 'ready'),
      active: sortedContributions.filter((item) => getContributionBucket(item) === 'active'),
      waiting: sortedContributions.filter((item) => getContributionBucket(item) === 'waiting'),
      done: sortedContributions.filter((item) => getContributionBucket(item) === 'done'),
    };
  }, [sortedContributions]);

  const selectedSummary = sortedContributions.find((item) => item.id === selectedContributionId) ?? null;
  const isProjectDirty = useMemo(
    () => (savedProjectSettings ? serializeProjectSettings(savedProjectSettings) !== serializeProjectSettings(projectDraft) : false),
    [projectDraft, savedProjectSettings],
  );
  const installSnippet = useMemo(
    () => (savedProjectSettings ? buildInstallSnippet(savedProjectSettings) : ''),
    [savedProjectSettings],
  );

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="eyebrow">Crowdship admin</div>
          <h1>Owner cockpit</h1>
          <p>Keep review focused. Keep config and operations out of the request lane.</p>
        </div>

        <nav className="sidebar-nav" aria-label="Admin sections">
          {navSections.map((section) => (
            <div className="sidebar-nav-group" key={section.title}>
              <div className="sidebar-nav-label">{section.title}</div>
              {section.items.map((item) => (
                <button
                  className={`sidebar-link${activeSection === item.id ? ' sidebar-link-active' : ''}`}
                  key={item.id}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                >
                  <span>{item.label}</span>
                  <small>{item.blurb}</small>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-status" aria-label="Shell status">
          <span className="chip chip-ready">Shell ready</span>
          <span className="chip chip-neutral">{sentryDsn ? 'Sentry env present' : 'Sentry env missing'}</span>
          <span className="chip chip-neutral">
            {intakeStatus === 'loading'
              ? 'Loading inbox'
              : intakeStatus === 'error'
                ? 'Inbox unavailable'
                : `${intakeQueue.length} contribution${intakeQueue.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </aside>

      <section className="content-shell">
        <header className="content-header">
          {activeSection === 'inbox' ? (
            <>
              <div>
                <div className="page-kicker">Inbox</div>
                <h2>Contribution review</h2>
                <p>Inbox stays first. Open any request without leaving the list.</p>
              </div>
            </>
          ) : activeSection === 'settings' ? (
            <>
              <div>
                <div className="page-kicker">Settings</div>
                <h2>Project and widget config</h2>
                <p>Everything install-related lives here instead of crowding review.</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="page-kicker">Operations</div>
                <h2>Queue and runtime watch</h2>
                <p>Delivery failures and in-flight work stay separate from normal request review.</p>
              </div>
            </>
          )}
        </header>

        {activeSection === 'settings' ? (
          <SettingsView
            settingsStatus={projectSettingsStatus}
            settingsError={projectSettingsError}
            savedProjectSettings={savedProjectSettings}
            projectDraft={projectDraft}
            projectActionState={projectActionState}
            projectActionMessage={projectActionMessage}
            isProjectDirty={isProjectDirty}
            installSnippet={installSnippet}
            onFieldChange={updateProjectField}
            onAllowedOriginChange={updateAllowedOrigin}
            onAddAllowedOrigin={addAllowedOrigin}
            onRemoveAllowedOrigin={removeAllowedOrigin}
            onResetDraft={resetProjectDraft}
            onRetry={() => {
              clearProjectActionFeedback();
              void loadProjectSettings();
            }}
            onSubmit={() => {
              void publishProjectSettings();
            }}
          />
        ) : intakeStatus === 'loading' ? (
          <div className="empty-state">Loading live contribution intake.</div>
        ) : intakeStatus === 'error' ? (
          <div className="empty-state">Could not load live intake: {intakeError}</div>
        ) : activeSection === 'operations' ? (
          <OperationsView
            readiness={readiness}
            attentionItems={groupedContributions.attention}
            activeItems={groupedContributions.active}
            onOpenContribution={setSelectedContributionId}
            selectedContributionId={selectedContributionId}
          />
        ) : (
          <section className="section-stack">
            <InboxSection
              title="Inbox"
              note="The queue stays sorted by the next real decision or delivery state."
              items={sortedContributions}
              selectedContributionId={selectedContributionId}
              onOpen={setSelectedContributionId}
              emptyLabel="No contribution is in the inbox."
            />
          </section>
        )}
      </section>

      {selectedContributionId ? (
        <ContributionDetailDrawer
          selectedSummary={selectedSummary}
          detail={detail}
          detailStatus={detailStatus}
          detailError={detailError}
          onClose={() => setSelectedContributionId(null)}
          onQueueImplementation={() =>
            void submitReviewAction(
              `/api/v1/contributions/${selectedContributionId}/queue-implementation`,
              reviewForms.implementation,
              'Implementation queued.',
            )
          }
          onOpenVoting={() =>
            void submitReviewAction(
              `/api/v1/contributions/${selectedContributionId}/open-voting`,
              {},
              'Voting opened.',
            )
          }
          onMarkMerged={() =>
            void submitReviewAction(
              `/api/v1/contributions/${selectedContributionId}/mark-merged`,
              {},
              'Merged state recorded.',
            )
          }
          reviewActionState={reviewActionState}
          reviewActionMessage={reviewActionMessage}
          reviewForms={reviewForms}
          setReviewForms={setReviewForms}
          submitReviewAction={submitReviewAction}
        />
      ) : null}
    </main>
  );
}
