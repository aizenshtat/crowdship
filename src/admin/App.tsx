import { useCallback, useEffect, useMemo, useState } from 'react';

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

type ContributionSummary = {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  payload?: ContributionPayload;
  latestSpecVersion?: number | null;
  specApprovedAt?: string | null;
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
  branchName: string;
  repositoryFullName: string;
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
  headSha: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ReviewPreviewDeploymentRecord = {
  id: string;
  url: string;
  status: string;
  gitSha: string;
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

type ContributionReview = {
  implementation: {
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

const projectConfig = [
  { label: 'Project', value: 'example' },
  { label: 'Owner host', value: 'crowdship.aizenshtat.eu' },
  { label: 'Environment', value: 'production' },
  { label: 'Widget script', value: 'https://crowdship.aizenshtat.eu/widget/v1.js' },
] as const;

const originAllowlist = ['https://example.aizenshtat.eu', 'http://localhost:4173'] as const;

const installSnippet = `<script
  async
  src="https://crowdship.aizenshtat.eu/widget/v1.js"
  data-crowdship-project="example"
  data-crowdship-environment="production"
  data-crowdship-launcher="manual"
  data-crowdship-user-id="customer-123"
  data-crowdship-user-email="customer@example.com"
  data-crowdship-user-role="customer"
></script>`;

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
    default:
      return state.replace(/_/g, ' ');
  }
}

function contributionStateClassName(state: string) {
  switch (state) {
    case 'spec_pending_approval':
      return 'pill-pending';
    case 'spec_approved':
      return 'pill-ready';
    default:
      return 'pill-empty';
  }
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
    normalized.includes('open')
  ) {
    return 'pill-ready';
  }

  if (
    normalized.includes('queue') ||
    normalized.includes('pending') ||
    normalized.includes('running') ||
    normalized.includes('active') ||
    normalized.includes('review')
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

export function App() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim() ?? '';
  const [intakeQueue, setIntakeQueue] = useState<ContributionSummary[]>([]);
  const [intakeStatus, setIntakeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [intakeError, setIntakeError] = useState('');
  const [selectedContributionId, setSelectedContributionId] = useState<string | null>(null);
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<ContributionDetail | null>(null);
  const [reviewActionState, setReviewActionState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [reviewActionMessage, setReviewActionMessage] = useState('');
  const [reviewForms, setReviewForms] = useState({
    implementation: {
      repositoryFullName: '',
      branchName: '',
      queueName: '',
    },
    pullRequest: {
      repositoryFullName: '',
      branchName: '',
      headSha: '',
    },
    previewDeployment: {
      url: '',
      gitSha: '',
      deployKind: '',
    },
    vote: {
      voteType: 'approve',
      voterUserId: '',
      voterEmail: '',
    },
    comment: {
      authorRole: 'admin',
      body: '',
      disposition: '',
    },
  });

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
    let cancelled = false;

    async function loadContributions() {
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

        const nextQueue = payload.contributions ?? [];
        setIntakeQueue(nextQueue);
        setSelectedContributionId((current) => current ?? nextQueue[0]?.id ?? null);
        setIntakeStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setIntakeStatus('error');
        setIntakeError(error instanceof Error ? error.message : 'Could not load contribution intake.');
      }
    }

    void loadContributions();

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
    if (!detail?.review) {
      return;
    }

    const implementationJob = detail.review.implementation.jobs[0];
    const pullRequest = detail.review.pullRequests[0];
    const previewDeployment = detail.review.previewDeployments[0];

    setReviewForms((current) => ({
      implementation: {
        repositoryFullName: current.implementation.repositoryFullName || implementationJob?.repositoryFullName || '',
        branchName: current.implementation.branchName || implementationJob?.branchName || '',
        queueName: current.implementation.queueName || implementationJob?.queueName || '',
      },
      pullRequest: {
        repositoryFullName: current.pullRequest.repositoryFullName || pullRequest?.repositoryFullName || '',
        branchName: current.pullRequest.branchName || pullRequest?.branchName || '',
        headSha: current.pullRequest.headSha || pullRequest?.headSha || '',
      },
      previewDeployment: {
        url: current.previewDeployment.url || previewDeployment?.url || '',
        gitSha: current.previewDeployment.gitSha || previewDeployment?.gitSha || '',
        deployKind: current.previewDeployment.deployKind || previewDeployment?.deployKind || '',
      },
      vote: current.vote,
      comment: current.comment,
    }));
  }, [detail?.review]);

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
      await refreshDetail(selectedContributionId);
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
            : intakeStatus === 'error'
              ? 'pending'
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

  const selectedSummary = intakeQueue.find((item) => item.id === selectedContributionId) ?? null;
  const selectedSummaryContext = selectedSummary ? describeContext(selectedSummary.payload) : null;
  const selectedDetailContext = detail ? describeContext(detail.contribution.payload) : null;
  const review = detail?.review ?? null;
  const reviewSummary = review?.votes.summary ?? { approve: 0, block: 0, total: 0 };
  const reviewJobCount = review?.implementation.jobs.length ?? 0;
  const reviewPrCount = review?.pullRequests.length ?? 0;
  const reviewDeploymentCount = review?.previewDeployments.length ?? 0;
  const reviewVoteCount = review?.votes.items.length ?? 0;
  const reviewCommentCount = review?.comments.length ?? 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="eyebrow">Crowdship admin / contribution review</div>
        <h1>Crowdship owner cockpit</h1>
        <p className="lede">Project install state, live contribution intake, and the requester-facing spec record backed by the API.</p>
        <div className="chips" aria-label="Shell status">
          <span className="chip chip-ready">Shell ready</span>
          <span className="chip chip-neutral">{sentryDsn ? 'Sentry env present' : 'Sentry env missing'}</span>
          <span className="chip chip-neutral">
            {intakeStatus === 'loading'
              ? 'Loading intake'
              : intakeStatus === 'error'
                ? 'Intake unavailable'
                : `${intakeQueue.length} intake${intakeQueue.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </header>

      <section className="band" aria-labelledby="project-config-title">
        <div className="band-grid">
          <div className="band-block">
            <div className="band-title-row">
              <h2 id="project-config-title">Project config</h2>
              <span className="band-note">Owner-controlled project state.</span>
            </div>
            <dl className="definition-list">
              {projectConfig.map((item) => (
                <div className="definition-row" key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="band-block">
            <div className="band-title-row">
              <h2 id="setup-readiness-title">Setup readiness</h2>
              <span className="band-note">Real shell state only.</span>
            </div>
            <ul className="status-list" aria-labelledby="setup-readiness-title">
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
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="allowlist-title">
        <div className="band-grid">
          <div className="band-block">
            <div className="band-title-row">
              <h2 id="allowlist-title">Origin allowlist</h2>
              <span className="band-note">Widget origins only.</span>
            </div>
            <ul className="origin-list">
              {originAllowlist.map((origin) => (
                <li className="origin-row" key={origin}>
                  <span className="origin-host">{origin}</span>
                  <span className="origin-state">Allowed</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="band-block">
            <div className="band-title-row">
              <h2 id="snippet-title">Widget install snippet</h2>
              <span className="band-note">Paste into the host app.</span>
            </div>
            <div className="snippet-shell" aria-labelledby="snippet-title">
              <div className="snippet-actions">
                <CopyButton text={installSnippet} />
              </div>
              <pre className="snippet-code">
                <code>{installSnippet}</code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="contributions-title">
        <div className="band-title-row">
          <div>
            <h2 id="contributions-title">Contribution intake</h2>
            <span className="band-note">Requester-facing records with spec versions and lifecycle history.</span>
          </div>
          <span className="band-note">
            {intakeStatus === 'ready' ? 'API connected' : intakeStatus === 'error' ? 'API error' : 'Loading API'}
          </span>
        </div>
        {intakeStatus === 'loading' ? (
          <div className="contribution-empty">Loading live contribution intake.</div>
        ) : intakeStatus === 'error' ? (
          <div className="contribution-empty">Could not load live intake: {intakeError}</div>
        ) : intakeQueue.length === 0 ? (
          <div className="contribution-empty">No contribution has been posted yet.</div>
        ) : (
          <div className="review-layout">
            <ul className="contribution-list" aria-label="Contribution intake list">
              {intakeQueue.map((item) => {
                const { route, context } = describeContext(item.payload);
                const isSelected = item.id === selectedContributionId;

                return (
                  <li className={`contribution-item contribution-item-selectable${isSelected ? ' contribution-item-selected' : ''}`} key={item.id}>
                    <div className="contribution-copy">
                      <div className="contribution-heading">
                        <div className="contribution-heading-copy">
                          <span className="contribution-kicker">Live contribution</span>
                          <h3>{item.title}</h3>
                        </div>
                        <StatePill state={item.state} />
                      </div>
                      <dl className="contribution-meta">
                        <div>
                          <dt>Route</dt>
                          <dd>{route}</dd>
                        </div>
                        <div>
                          <dt>Context</dt>
                          <dd>{context}</dd>
                        </div>
                        <div>
                          <dt>Spec</dt>
                          <dd>
                            {item.latestSpecVersion ? `v${item.latestSpecVersion}` : 'No spec yet'}
                            {item.specApprovedAt ? ` / approved ${formatTimestamp(item.specApprovedAt)}` : ''}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="owner-panel">
                      <div className="owner-panel-copy">
                        <div className="owner-panel-label">Review record</div>
                        <p>Open the full requester record, latest spec, attachments, and lifecycle evidence.</p>
                      </div>
                      <div className="owner-actions" aria-label="Review actions">
                        <button
                          className="action-button action-button-primary"
                          type="button"
                          onClick={() => setSelectedContributionId(item.id)}
                        >
                          {isSelected ? 'Viewing detail' : 'Open detail'}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <section className="detail-shell" aria-live="polite">
              {detailStatus === 'loading' && selectedSummary ? (
                <div className="detail-empty">Loading {selectedSummary.title}.</div>
              ) : detailStatus === 'error' ? (
                <div className="detail-empty">Could not load contribution detail: {detailError}</div>
              ) : !detail ? (
                <div className="detail-empty">Select a contribution to review its request record.</div>
              ) : (
                <>
                  <div className="detail-header">
                    <div>
                      <div className="detail-kicker">Requester record</div>
                      <h3>{detail.contribution.title}</h3>
                      <p>
                        {detail.contribution.body ?? 'No body provided.'}
                      </p>
                    </div>
                    <StatePill state={detail.contribution.state} />
                  </div>

                  <div className="detail-grid">
                    <section className="detail-section">
                      <div className="detail-section-title">Request context</div>
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
                          <dd>{selectedDetailContext?.route ?? selectedSummaryContext?.route ?? 'Not provided'}</dd>
                        </div>
                        <div className="definition-row">
                          <dt>Context</dt>
                          <dd>{selectedDetailContext?.context ?? selectedSummaryContext?.context ?? 'No additional context'}</dd>
                        </div>
                        <div className="definition-row">
                          <dt>Created</dt>
                          <dd>{formatTimestamp(detail.contribution.createdAt)}</dd>
                        </div>
                      </dl>
                    </section>

                    <section className="detail-section">
                      <div className="detail-section-title">Latest spec</div>
                      {detail.spec.current ? (
                        <div className="spec-card">
                          <div className="spec-header">
                            <div>
                              <div className="spec-version">Spec v{detail.spec.current.versionNumber}</div>
                              <h4>{detail.spec.current.title}</h4>
                            </div>
                            <span className="band-note">
                              {detail.spec.current.approvedAt
                                ? `Approved ${formatTimestamp(detail.spec.current.approvedAt)}`
                                : 'Waiting for requester approval'}
                            </span>
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
                        <div className="detail-empty detail-empty-compact">No spec has been generated yet.</div>
                      )}
                    </section>

                    <section className="detail-section">
                      <div className="detail-section-title">Delivery / review</div>
                      {review ? (
                        <div className="review-block">
                          <div className="review-summary-strip" aria-label="Review summary">
                            <div className="review-summary-item">
                              <span className="review-summary-label">Implementation jobs</span>
                              <strong>{reviewJobCount}</strong>
                            </div>
                            <div className="review-summary-item">
                              <span className="review-summary-label">Pull requests</span>
                              <strong>{reviewPrCount}</strong>
                            </div>
                            <div className="review-summary-item">
                              <span className="review-summary-label">Preview deployments</span>
                              <strong>{reviewDeploymentCount}</strong>
                            </div>
                            <div className="review-summary-item">
                              <span className="review-summary-label">Votes</span>
                              <strong>
                                {reviewSummary.approve} approve / {reviewSummary.block} block
                              </strong>
                            </div>
                            <div className="review-summary-item">
                              <span className="review-summary-label">Vote records</span>
                              <strong>{reviewVoteCount}</strong>
                            </div>
                            <div className="review-summary-item">
                              <span className="review-summary-label">Comments</span>
                              <strong>{reviewCommentCount}</strong>
                            </div>
                          </div>

                          <div className={`review-action-banner review-action-banner-${reviewActionState}`} aria-live="polite">
                            {reviewActionState === 'idle'
                              ? 'Use the compact actions below to advance delivery.'
                              : reviewActionMessage}
                          </div>

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
                                <button className="action-button action-button-primary" type="submit" disabled={reviewActionState === 'loading'}>
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
                                <button className="action-button action-button-primary" type="submit" disabled={reviewActionState === 'loading'}>
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
                                <button className="action-button action-button-primary" type="submit" disabled={reviewActionState === 'loading'}>
                                  {reviewActionState === 'loading' ? 'Recording…' : 'Record deployment'}
                                </button>
                              </div>
                            </form>

                            <div className="review-action-form review-action-form-inline">
                              <div className="review-form-title">Open voting</div>
                              <div className="review-form-copy">Marks the contribution ready for votes.</div>
                              <div className="review-form-actions">
                                <button
                                  className="action-button action-button-primary"
                                  type="button"
                                  disabled={reviewActionState === 'loading'}
                                  onClick={() =>
                                    void submitReviewAction(
                                      `/api/v1/contributions/${detail.contribution.id}/open-voting`,
                                      {},
                                      'Voting opened.',
                                    )
                                  }
                                >
                                  {reviewActionState === 'loading' ? 'Opening…' : 'Open voting'}
                                </button>
                              </div>
                            </div>

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
                                <button className="action-button action-button-primary" type="submit" disabled={reviewActionState === 'loading'}>
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
                                <button className="action-button action-button-primary" type="submit" disabled={reviewActionState === 'loading'}>
                                  {reviewActionState === 'loading' ? 'Recording…' : 'Add comment'}
                                </button>
                              </div>
                            </form>
                          </div>

                          <div className={`review-records review-records-${reviewJobCount > 0 ? 'full' : 'empty'}`}>
                            <section className="review-record-section">
                              <div className="review-record-title">Implementation jobs</div>
                              {review.implementation.jobs.length === 0 ? (
                                <div className="detail-empty detail-empty-compact">No implementation job has been queued.</div>
                              ) : (
                                <ul className="detail-stack-list">
                                  {review.implementation.jobs.map((job) => (
                                    <li className="stack-item" key={job.id}>
                                      <div className="stack-item-head">
                                        <span className="stack-item-title">
                                          {job.queueName} / {job.branchName}
                                        </span>
                                        <span className={`pill ${reviewPillClassName(job.status)}`}>{reviewStatusLabel(job.status)}</span>
                                      </div>
                                      <div className="stack-item-copy">
                                        {job.repositoryFullName} / created {formatTimestamp(job.createdAt)}
                                        {job.startedAt ? ` / started ${formatTimestamp(job.startedAt)}` : ''}
                                        {job.finishedAt ? ` / finished ${formatTimestamp(job.finishedAt)}` : ''}
                                      </div>
                                      {job.errorSummary ? <div className="stack-item-copy">{job.errorSummary}</div> : null}
                                      <div className="stack-item-copy">{formatJson(job.metadata)}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>

                            <section className="review-record-section">
                              <div className="review-record-title">Pull requests</div>
                              {review.pullRequests.length === 0 ? (
                                <div className="detail-empty detail-empty-compact">No pull request has been recorded.</div>
                              ) : (
                                <ul className="detail-stack-list">
                                  {review.pullRequests.map((pullRequest) => (
                                    <li className="stack-item" key={pullRequest.id}>
                                      <div className="stack-item-head">
                                        <span className="stack-item-title">
                                          <a href={pullRequest.url} target="_blank" rel="noreferrer">
                                            #{pullRequest.number}
                                          </a>{' '}
                                          / {pullRequest.branchName}
                                        </span>
                                        <span className={`pill ${reviewPillClassName(pullRequest.status)}`}>{reviewStatusLabel(pullRequest.status)}</span>
                                      </div>
                                      <div className="stack-item-copy">
                                        {pullRequest.repositoryFullName} / head {formatShortSha(pullRequest.headSha)}
                                      </div>
                                      <div className="stack-item-copy">
                                        Created {formatTimestamp(pullRequest.createdAt)} / updated {formatTimestamp(pullRequest.updatedAt)}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>

                            <section className="review-record-section">
                              <div className="review-record-title">Preview deployments</div>
                              {review.previewDeployments.length === 0 ? (
                                <div className="detail-empty detail-empty-compact">No preview deployment has been recorded.</div>
                              ) : (
                                <ul className="detail-stack-list">
                                  {review.previewDeployments.map((deployment) => (
                                    <li className="stack-item" key={deployment.id}>
                                      <div className="stack-item-head">
                                        <span className="stack-item-title">
                                          <a href={deployment.url} target="_blank" rel="noreferrer">
                                            {deployment.url}
                                          </a>
                                        </span>
                                        <span className={`pill ${reviewPillClassName(deployment.status)}`}>{reviewStatusLabel(deployment.status)}</span>
                                      </div>
                                      <div className="stack-item-copy">
                                        {deployment.deployKind} / sha {formatShortSha(deployment.gitSha)}
                                      </div>
                                      <div className="stack-item-copy">
                                        Created {formatTimestamp(deployment.createdAt)}
                                        {deployment.deployedAt ? ` / deployed ${formatTimestamp(deployment.deployedAt)}` : ''}
                                        {deployment.checkedAt ? ` / checked ${formatTimestamp(deployment.checkedAt)}` : ''}
                                      </div>
                                      {deployment.errorSummary ? <div className="stack-item-copy">{deployment.errorSummary}</div> : null}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>

                            <section className="review-record-section">
                              <div className="review-record-title">Votes</div>
                              <div className="review-vote-summary">
                                <span className="pill pill-ready">Approve {reviewSummary.approve}</span>
                                <span className="pill pill-error">Block {reviewSummary.block}</span>
                                <span className="pill pill-neutral">Total {reviewSummary.total}</span>
                              </div>
                              {review.votes.items.length === 0 ? (
                                <div className="detail-empty detail-empty-compact">No vote has been cast yet.</div>
                              ) : (
                                <ul className="detail-stack-list">
                                  {review.votes.items.map((vote) => (
                                    <li className="stack-item" key={vote.id}>
                                      <div className="stack-item-head">
                                        <span className="stack-item-title">{vote.voteType}</span>
                                        <span className="stack-item-meta">{formatTimestamp(vote.createdAt)}</span>
                                      </div>
                                      <div className="stack-item-copy">
                                        {vote.voterUserId ?? 'Unknown user'}
                                        {vote.voterEmail ? ` / ${vote.voterEmail}` : ''}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>

                            <section className="review-record-section">
                              <div className="review-record-title">Comments</div>
                              {review.comments.length === 0 ? (
                                <div className="detail-empty detail-empty-compact">No review comment has been added.</div>
                              ) : (
                                <ul className="detail-stack-list">
                                  {review.comments.map((comment) => (
                                    <li className="stack-item" key={comment.id}>
                                      <div className="stack-item-head">
                                        <span className="stack-item-title">{comment.authorRole}</span>
                                        <span className="stack-item-meta">{formatTimestamp(comment.createdAt)}</span>
                                      </div>
                                      <div className="stack-item-copy">{comment.body}</div>
                                      <div className="stack-item-copy">{comment.disposition}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </section>
                          </div>
                        </div>
                      ) : (
                        <div className="detail-empty detail-empty-compact">No delivery or review record is available yet.</div>
                      )}
                    </section>

                    <section className="detail-section">
                      <div className="detail-section-title">Attachments</div>
                      {detail.attachments.length === 0 ? (
                        <div className="detail-empty detail-empty-compact">No attachment metadata was shared.</div>
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
                    </section>

                    <section className="detail-section">
                      <div className="detail-section-title">Conversation</div>
                      {detail.conversation.length === 0 ? (
                        <div className="detail-empty detail-empty-compact">No requester conversation is stored yet.</div>
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
                    </section>

                    <section className="detail-section">
                      <div className="detail-section-title">Lifecycle</div>
                      <ul className="detail-stack-list">
                        {detail.lifecycle.events.map((event) => (
                          <li className="stack-item" key={event.id}>
                            <div className="stack-item-head">
                              <span className="stack-item-title">{event.message}</span>
                              <span className="stack-item-meta">{formatTimestamp(event.createdAt)}</span>
                            </div>
                            <div className="stack-item-copy">{event.kind.replace(/_/g, ' ')} / {event.status.replace(/_/g, ' ')}</div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
