import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function loadNotificationsModule() {
  const source = readFileSync(join(root, 'src/admin/notifications.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'notifications.ts',
  });
  const tempDir = mkdtempSync(join(tmpdir(), 'crowdship-admin-notifications-'));
  const modulePath = join(tempDir, 'notifications.mjs');
  writeFileSync(modulePath, outputText, 'utf8');
  return import(pathToFileURL(modulePath).href);
}

test('notification settings load merges stored values with known projects', async () => {
  const notifications = await loadNotificationsModule();
  const storage = {
    getItem() {
      return JSON.stringify({
        enabled: true,
        quietMode: {
          enabled: true,
          start: '21:30',
          end: '07:15',
        },
        projects: {
          example: {
            enabled: false,
            label: 'Orbital Ops',
          },
        },
      });
    },
    setItem() {},
  };

  const settings = notifications.loadNotificationSettings(storage, [
    { slug: 'example', label: 'Orbital Ops' },
    { slug: 'apollo', label: 'Apollo Console' },
  ]);

  assert.equal(settings.enabled, true);
  assert.deepEqual(settings.quietMode, {
    enabled: true,
    start: '21:30',
    end: '07:15',
  });
  assert.equal(settings.projects.example.enabled, false);
  assert.equal(settings.projects.example.label, 'Orbital Ops');
  assert.equal(settings.projects.apollo.enabled, true);
  assert.equal(settings.projects.apollo.label, 'Apollo Console');
});

test('notification events only fire for newly actionable states on enabled projects', async () => {
  const notifications = await loadNotificationsModule();
  const settings = notifications.syncNotificationSettings(
    {
      enabled: true,
      projects: {
        example: { enabled: true, label: 'Orbital Ops' },
        paused: { enabled: false, label: 'Paused Project' },
      },
    },
    [
      { slug: 'example', label: 'Orbital Ops' },
      { slug: 'paused', label: 'Paused Project' },
    ],
  );

  const events = notifications.deriveContributionNotificationEvents(
    [
      {
        id: 'ctrb-1',
        projectSlug: 'example',
        title: 'Replay signal drop',
        state: 'agent_running',
        updatedAt: '2026-04-20T10:00:00Z',
      },
      {
        id: 'ctrb-2',
        projectSlug: 'paused',
        title: 'Quiet project change',
        state: 'agent_running',
        updatedAt: '2026-04-20T10:00:00Z',
      },
    ],
    [
      {
        id: 'ctrb-1',
        projectSlug: 'example',
        title: 'Replay signal drop',
        state: 'preview_ready',
        updatedAt: '2026-04-20T10:05:00Z',
      },
      {
        id: 'ctrb-2',
        projectSlug: 'paused',
        title: 'Quiet project change',
        state: 'preview_ready',
        updatedAt: '2026-04-20T10:05:00Z',
      },
      {
        id: 'ctrb-3',
        projectSlug: 'example',
        title: 'Spec review',
        state: 'spec_pending_approval',
        updatedAt: '2026-04-20T10:06:00Z',
      },
    ],
    settings,
  );

  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.title),
    ['Preview ready', 'Spec needs approval'],
  );
  assert.ok(events.every((event) => event.projectSlug === 'example'));
});

test('quiet mode handles overnight windows and badge sync uses actionable counts', async () => {
  const notifications = await loadNotificationsModule();
  const settings = notifications.syncNotificationSettings(
    {
      enabled: true,
      quietMode: {
        enabled: true,
        start: '22:00',
        end: '08:00',
      },
      projects: {
        example: { enabled: true, label: 'Orbital Ops' },
      },
    },
    [{ slug: 'example', label: 'Orbital Ops' }],
  );

  assert.equal(notifications.isQuietModeActive(settings, new Date('2026-04-20T23:30:00')), true);
  assert.equal(notifications.isQuietModeActive(settings, new Date('2026-04-20T12:30:00')), false);

  const badgeCalls = [];
  await notifications.syncAdminBadgeCount(3, {
    async setAppBadge(count) {
      badgeCalls.push(['set', count]);
    },
    async clearAppBadge() {
      badgeCalls.push(['clear']);
    },
  });
  await notifications.syncAdminBadgeCount(0, {
    async setAppBadge(count) {
      badgeCalls.push(['set', count]);
    },
    async clearAppBadge() {
      badgeCalls.push(['clear']);
    },
  });

  assert.deepEqual(badgeCalls, [['set', 3], ['clear']]);
});

test('notification delivery prefers the service worker registration and falls back cleanly', async () => {
  const notifications = await loadNotificationsModule();
  const delivered = [];

  const channel = await notifications.deliverAdminNotification(
    {
      contributionId: 'ctrb-99',
      projectSlug: 'example',
      state: 'preview_ready',
      tag: 'crowdship:ctrb-99:preview',
      title: 'Preview ready',
      body: 'Replay signal drop has a preview ready for review.',
      url: '/?section=inbox&contribution=ctrb-99',
    },
    {
      serviceWorker: {
        ready: Promise.resolve({
          async showNotification(title, options) {
            delivered.push({ title, options });
          },
        }),
      },
    },
  );

  assert.equal(channel, 'service_worker');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].title, 'Preview ready');
  assert.equal(delivered[0].options.data.url, '/?section=inbox&contribution=ctrb-99');
});
