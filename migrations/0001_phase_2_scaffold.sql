CREATE TABLE IF NOT EXISTS projects (
  slug text PRIMARY KEY,
  name text NOT NULL,
  public_config jsonb NOT NULL,
  allowed_origins jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contributions (
  id text PRIMARY KEY,
  project_slug text NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  state text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_role text NOT NULL,
  message_type text NOT NULL,
  body text NOT NULL,
  choices jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS spec_versions (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  title text NOT NULL,
  goal text NOT NULL,
  user_problem text NOT NULL,
  spec jsonb NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS progress_events (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  message text NOT NULL,
  external_url text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS votes (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  voter_user_id text,
  voter_email text,
  vote_type text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  author_user_id text,
  author_role text NOT NULL,
  body text NOT NULL,
  disposition text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS implementation_jobs (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  status text NOT NULL,
  queue_name text NOT NULL,
  branch_name text,
  repository_full_name text,
  github_run_id text,
  started_at timestamptz,
  finished_at timestamptz,
  error_summary text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  repository_full_name text NOT NULL,
  number integer NOT NULL,
  url text NOT NULL,
  branch_name text NOT NULL,
  head_sha text,
  status text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS preview_deployments (
  id text PRIMARY KEY,
  contribution_id text NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
  pull_request_id text REFERENCES pull_requests(id) ON DELETE SET NULL,
  url text NOT NULL,
  status text NOT NULL,
  git_sha text,
  deploy_kind text NOT NULL,
  deployed_at timestamptz,
  checked_at timestamptz,
  error_summary text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contributions_project_slug_idx ON contributions (project_slug);
CREATE INDEX IF NOT EXISTS contributions_state_idx ON contributions (state);
CREATE INDEX IF NOT EXISTS attachments_contribution_id_idx ON attachments (contribution_id);
CREATE INDEX IF NOT EXISTS chat_messages_contribution_id_idx ON chat_messages (contribution_id);
CREATE INDEX IF NOT EXISTS spec_versions_contribution_id_idx ON spec_versions (contribution_id);
CREATE INDEX IF NOT EXISTS progress_events_contribution_id_idx ON progress_events (contribution_id);
CREATE INDEX IF NOT EXISTS votes_contribution_id_idx ON votes (contribution_id);
CREATE INDEX IF NOT EXISTS comments_contribution_id_idx ON comments (contribution_id);
CREATE INDEX IF NOT EXISTS implementation_jobs_contribution_id_idx ON implementation_jobs (contribution_id);
CREATE INDEX IF NOT EXISTS pull_requests_contribution_id_idx ON pull_requests (contribution_id);
CREATE INDEX IF NOT EXISTS preview_deployments_contribution_id_idx ON preview_deployments (contribution_id);
