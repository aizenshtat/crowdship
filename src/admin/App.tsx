import { useEffect, useMemo, useState } from 'react';

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

type ContributionDetail = {
  contribution: ContributionSummary & {
    body?: string | null;
    projectSlug: string;
    environment: string;
    type: string;
  };
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

    let cancelled = false;

    async function loadDetail() {
      try {
        setDetailStatus('loading');
        setDetailError('');

        const response = await fetch(`/api/v1/contributions/${selectedContributionId}`, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Contribution detail returned ${response.status}`);
        }

        const payload = (await response.json()) as ContributionDetail;

        if (cancelled) {
          return;
        }

        setDetail(payload);
        setDetailStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }

        setDetailStatus('error');
        setDetailError(error instanceof Error ? error.message : 'Could not load contribution detail.');
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedContributionId]);

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
