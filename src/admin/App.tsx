import { useEffect, useMemo, useState } from 'react';

type ReadinessState = 'ready' | 'pending' | 'empty';

type ReadinessItem = {
  label: string;
  state: ReadinessState;
  detail: string;
};

type ContributionRecord = {
  id: string;
  title: string;
  state: string;
  route: string;
  context: string;
  createdEvent: string;
};

type ContributionPayload = {
  route?: string;
  context?: {
    selectedObjectType?: string;
    selectedObjectId?: string;
    activeFilters?: Record<string, string>;
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

function ContributionPill() {
  return <span className="pill pill-pending">Pending owner review</span>;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }) + ' UTC';
}

function toContributionRecord(entry: {
  id: string;
  title: string;
  state: string;
  createdAt: string;
  payload?: ContributionPayload;
}): ContributionRecord {
  const contextParts = [];
  const context = entry.payload?.context;

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
    id: entry.id,
    title: entry.title,
    state: entry.state,
    route: entry.payload?.route ?? 'Not provided',
    context: contextParts.join(', ') || 'No additional context',
    createdEvent: `Widget intake created at ${formatTimestamp(entry.createdAt)}`,
  };
}

export function App() {
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN?.trim() ?? '';
  const [intakeQueue, setIntakeQueue] = useState<ContributionRecord[]>([]);
  const [intakeStatus, setIntakeStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [intakeError, setIntakeError] = useState('');

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
          contributions?: Array<{
            id: string;
            title: string;
            state: string;
            createdAt: string;
            payload?: ContributionPayload;
          }>;
        };

        if (cancelled) {
          return;
        }

        setIntakeQueue((payload.contributions ?? []).map(toContributionRecord));
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
        state: intakeStatus === 'ready' ? (intakeQueue.length > 0 ? 'ready' : 'empty') : intakeStatus === 'error' ? 'pending' : 'pending',
        detail:
          intakeStatus === 'ready'
            ? intakeQueue.length > 0
              ? `${intakeQueue.length} live request${intakeQueue.length === 1 ? '' : 's'} ready for owner review.`
              : 'No live requests yet.'
            : intakeStatus === 'error'
              ? 'The intake API did not respond cleanly.'
              : 'Loading live intake from the API.',
      },
    ],
    [intakeQueue.length, intakeStatus, sentryDsn],
  );

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="eyebrow">Crowdship admin / PWA shell</div>
        <h1>Crowdship owner cockpit</h1>
        <p className="lede">Project config, origin allowlist, widget install snippet, and intake review surface.</p>
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
              <span className="band-note">Shell state only.</span>
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
            <span className="band-note">Live requests from the widget.</span>
          </div>
          <span className="band-note">{intakeStatus === 'ready' ? 'API connected' : intakeStatus === 'error' ? 'API error' : 'Loading API'}</span>
        </div>
        {intakeStatus === 'loading' ? (
          <div className="contribution-empty">Loading live contribution intake.</div>
        ) : intakeStatus === 'error' ? (
          <div className="contribution-empty">Could not load live intake: {intakeError}</div>
        ) : intakeQueue.length === 0 ? (
          <div className="contribution-empty">No contribution has been posted yet.</div>
        ) : (
          <ul className="contribution-list" aria-label="Contribution intake list">
            {intakeQueue.map((item) => (
              <li className="contribution-item" key={item.id}>
                <div className="contribution-copy">
                  <div className="contribution-heading">
                    <div className="contribution-heading-copy">
                      <span className="contribution-kicker">New contribution</span>
                      <h3>{item.title}</h3>
                    </div>
                    <ContributionPill />
                  </div>
                  <dl className="contribution-meta">
                    <div>
                      <dt>Route</dt>
                      <dd>{item.route}</dd>
                    </div>
                    <div>
                      <dt>Context</dt>
                      <dd>{item.context}</dd>
                    </div>
                    <div>
                      <dt>Created event</dt>
                      <dd>{item.createdEvent}</dd>
                    </div>
                  </dl>
                </div>
                <div className="owner-panel">
                  <div className="owner-panel-copy">
                    <div className="owner-panel-label">Owner actions</div>
                    <p>Spec approval and review endpoints still need implementation.</p>
                  </div>
                  <div className="owner-actions" aria-label="Owner actions">
                    <button className="action-button" type="button" disabled title="Pending backend endpoints">
                      Approve contribution
                    </button>
                    <button className="action-button" type="button" disabled title="Pending backend endpoints">
                      Request changes
                    </button>
                    <button className="action-button" type="button" disabled title="Pending backend endpoints">
                      Open review record
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
