ALTER TABLE projects
ADD COLUMN IF NOT EXISTS runtime_config jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO projects (
  slug,
  name,
  public_config,
  allowed_origins,
  runtime_config
)
VALUES (
  'example',
  'Orbital Ops',
  '{
    "project": "example",
    "widgetScriptUrl": "https://crowdship.aizenshtat.eu/widget/v1.js",
    "allowedOrigins": [
      "https://example.aizenshtat.eu",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:4173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://localhost:4173",
      "http://localhost:5173"
    ],
    "contributionStates": [
      "draft_chat",
      "spec_pending_approval",
      "spec_approved",
      "agent_queued",
      "agent_running",
      "implementation_failed",
      "pr_opened",
      "preview_deploying",
      "preview_failed",
      "preview_ready",
      "requester_review",
      "revision_requested",
      "ready_for_voting",
      "voting_open",
      "core_team_flagged",
      "core_review",
      "merged",
      "production_deploying",
      "completed",
      "rejected"
    ]
  }'::jsonb,
  '[
    "https://example.aizenshtat.eu",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://localhost:4173",
    "http://localhost:5173"
  ]'::jsonb,
  '{
    "executionMode": "hosted",
    "automationPolicy": "hosted_example",
    "repositoryFullName": "aizenshtat/example",
    "repoPath": "/root/example",
    "defaultBranch": "main",
    "previewDeployScript": "/root/example/scripts/deploy-preview.sh",
    "previewBaseUrl": "https://example.aizenshtat.eu",
    "previewUrlPattern": "https://example.aizenshtat.eu/previews/{contributionId}/",
    "productionBaseUrl": "https://example.aizenshtat.eu"
  }'::jsonb
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  public_config = EXCLUDED.public_config,
  allowed_origins = EXCLUDED.allowed_origins,
  runtime_config = EXCLUDED.runtime_config,
  updated_at = now();
