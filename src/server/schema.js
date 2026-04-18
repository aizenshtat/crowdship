import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const tableNameList = [
  'projects',
  'contributions',
  'attachments',
  'chat_messages',
  'spec_versions',
  'progress_events',
  'votes',
  'comments',
  'implementation_jobs',
  'pull_requests',
  'preview_deployments',
];

export const SCHEMA_TABLE_NAMES = Object.freeze(tableNameList.slice());

export const projects = pgTable('projects', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  publicConfig: jsonb('public_config').notNull(),
  allowedOrigins: jsonb('allowed_origins').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const contributions = pgTable('contributions', {
  id: text('id').primaryKey(),
  projectSlug: text('project_slug')
    .notNull()
    .references(() => projects.slug, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  authorRole: text('author_role').notNull(),
  messageType: text('message_type').notNull(),
  body: text('body').notNull(),
  choices: jsonb('choices'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const specVersions = pgTable('spec_versions', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  userProblem: text('user_problem').notNull(),
  spec: jsonb('spec').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const progressEvents = pgTable('progress_events', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  message: text('message').notNull(),
  externalUrl: text('external_url'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const votes = pgTable('votes', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  voterUserId: text('voter_user_id'),
  voterEmail: text('voter_email'),
  voteType: text('vote_type').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const comments = pgTable('comments', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  authorUserId: text('author_user_id'),
  authorRole: text('author_role').notNull(),
  body: text('body').notNull(),
  disposition: text('disposition').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const implementationJobs = pgTable('implementation_jobs', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  queueName: text('queue_name').notNull(),
  branchName: text('branch_name'),
  repositoryFullName: text('repository_full_name'),
  githubRunId: text('github_run_id'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
  errorSummary: text('error_summary'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const pullRequests = pgTable('pull_requests', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  repositoryFullName: text('repository_full_name').notNull(),
  number: integer('number').notNull(),
  url: text('url').notNull(),
  branchName: text('branch_name').notNull(),
  headSha: text('head_sha'),
  status: text('status').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const previewDeployments = pgTable('preview_deployments', {
  id: text('id').primaryKey(),
  contributionId: text('contribution_id')
    .notNull()
    .references(() => contributions.id, { onDelete: 'cascade' }),
  pullRequestId: text('pull_request_id').references(() => pullRequests.id, {
    onDelete: 'set null',
  }),
  url: text('url').notNull(),
  status: text('status').notNull(),
  gitSha: text('git_sha'),
  deployKind: text('deploy_kind').notNull(),
  deployedAt: timestamp('deployed_at', { withTimezone: true, mode: 'date' }),
  checkedAt: timestamp('checked_at', { withTimezone: true, mode: 'date' }),
  errorSummary: text('error_summary'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const schemaTables = Object.freeze({
  projects,
  contributions,
  attachments,
  chatMessages,
  specVersions,
  progressEvents,
  votes,
  comments,
  implementationJobs,
  pullRequests,
  previewDeployments,
});

export const schemaTableMap = Object.freeze({
  projects: 'projects',
  contributions: 'contributions',
  attachments: 'attachments',
  chat_messages: 'chat_messages',
  spec_versions: 'spec_versions',
  progress_events: 'progress_events',
  votes: 'votes',
  comments: 'comments',
  implementation_jobs: 'implementation_jobs',
  pull_requests: 'pull_requests',
  preview_deployments: 'preview_deployments',
});
