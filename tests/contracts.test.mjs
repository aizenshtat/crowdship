import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

function assertFile(relativePath) {
  assert.ok(existsSync(join(root, relativePath)), `${relativePath} should exist`);
}

test('quality infrastructure files exist', () => {
  [
    '.agents/mcp/README.md',
    '.agents/skills/crowdship-ui-ux/SKILL.md',
    '.agents/skills/crowdship-ui-ux/references/quality-gates.md',
    '.githooks/pre-commit',
    '.env.example',
    '.github/workflows/smoke.yml',
    'docs/agent-tooling.md',
    'docs/implementation-plan.md',
    'docs/ui-quality-contract.md',
    'index.html',
    'migrations/0001_phase_2_scaffold.sql',
    'migrations/0002_spec_version_uniqueness.sql',
    'public/manifest.webmanifest',
    'public/sw.js',
    'public/widget/frame.html',
    'public/widget/v1.js',
    'scripts/quality-check.sh',
    'scripts/run-migrations.sh',
    'src/admin/App.tsx',
    'src/admin/main.tsx',
    'src/server/completion-service.js',
    'src/server/persistence.js',
    'src/server/schema.js',
    'src/shared/contracts.js',
    'tsconfig.json',
    'vite.config.ts',
  ].forEach(assertFile);
});

test('implementation plan references required contracts', () => {
  const plan = read('docs/implementation-plan.md');

  assert.match(plan, /Stack Decision/);
  assert.match(plan, /docs\/widget-contract\.md/);
  assert.match(plan, /docs\/contribution-lifecycle\.md/);
  assert.match(plan, /docs\/sentry\.md/);
  assert.match(plan, /\.agents\/skills\/crowdship-ui-ux\/SKILL\.md/);
  assert.match(plan, /\.\.\/example\/docs\/external-app-role\.md/);
});

test('ui contract preserves the product quality bar', () => {
  const contract = read('docs/ui-quality-contract.md');

  assert.match(contract, /No Simulation Rule/);
  assert.match(contract, /Mobile-First And PWA/);
  assert.match(contract, /Home Screen/);
  assert.match(contract, /Web Push/);
  assert.match(contract, /1440x900/);
  assert.match(contract, /390x844/);
  assert.match(contract, /Keyboard/);
  assert.match(contract, /Spec approval/);
  assert.match(contract, /Preview review/);
});

test('agent skill requires concrete user-facing gates', () => {
  const skill = read('.agents/skills/crowdship-ui-ux/SKILL.md');
  const gates = read('.agents/skills/crowdship-ui-ux/references/quality-gates.md');
  const visual = read('.agents/skills/crowdship-ui-ux/references/visual-language.md');

  assert.match(skill, /No simulation/);
  assert.match(skill, /Playwright/);
  assert.match(gates, /Desktop screenshot/);
  assert.match(gates, /Mobile screenshot/);
  assert.match(gates, /No secret values/);
  assert.match(gates, /Virtual keyboard/);
  assert.match(visual, /Mobile-First Layout/);
});

test('package scripts expose local quality commands', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.build, 'tsc --noEmit && vite build');
  assert.equal(pkg.scripts['db:migrate'], 'bash scripts/run-migrations.sh');
  assert.equal(pkg.scripts.quality, 'bash scripts/quality-check.sh');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
  assert.equal(pkg.scripts.lint, 'tsc --noEmit && bash -n scripts/*.sh .githooks/pre-commit');
});

test('phase 2 scaffold exposes real widget and admin boundaries', () => {
  const admin = read('src/admin/App.tsx');
  const widget = read('public/widget/v1.js');
  const frame = read('public/widget/frame.html');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  assert.match(admin, /Contribution review/);
  assert.match(admin, /fetch\('\/api\/v1\/contributions'/);
  assert.match(admin, /fetch\(`\/api\/v1\/contributions\/\$\{contributionId\}`/);
  assert.match(admin, /\/api\/v1\/projects\/\$\{encodeURIComponent\(DEFAULT_PROJECT_SLUG\)\}/);
  assert.match(admin, /Loading live contribution intake/);
  assert.match(admin, /Close review/);
  assert.match(admin, /Needs action/);
  assert.match(admin, /Queue implementation/);
  assert.match(admin, /Open voting/);
  assert.match(admin, /Request clarification/);
  assert.match(admin, /Flag core review/);
  assert.match(admin, /Start core review/);
  assert.match(admin, /Start production deploy/);
  assert.match(admin, /Mark completed/);
  assert.match(admin, /Archive/);
  assert.match(admin, /Publish settings/);
  assert.match(admin, /react_vite_app/);
  assert.match(admin, /Automation controls/);
  assert.match(admin, /Auto-queue implementation/);
  assert.match(admin, /Auto-open voting/);
  assert.match(admin, /Automation evidence/);
  assert.match(admin, /Comment dispositions/);
  assert.match(admin, /Live preview evidence/);
  assert.match(admin, /Refresh preview evidence/);
  assert.match(admin, /\/api\/v1\/contributions\/\$\{contributionId\}\/preview-evidence/);
  assert.match(admin, /\/api\/v1\/contributions\/\$\{detail\.contribution\.id\}\/comments\/\$\{comment\.id\}\/disposition/);
  assert.match(admin, /Widget install snippet/);
  assert.match(admin, /Host context starter/);
  assert.match(admin, /Optional identity starter/);
  assert.match(admin, /Install checklist/);
  assert.match(admin, /window\.Crowdship\.setContext/);
  assert.match(admin, /window\.Crowdship\.identify/);
  assert.match(widget, /window\.Crowdship = api/);
  assert.match(widget, /new URL\(WIDGET_PATH, widgetOrigin\)/);
  assert.match(frame, /Suggest a change/);
  assert.match(frame, /What should this product do better\?/);
  assert.match(frame, /hostOrigin: state\.hostOrigin \|\| ''/);
  assert.match(frame, /deriveHostOrigin\(event\.origin\)/);
  assert.match(frame, /\/api\/v1\/contributions/);
  assert.match(frame, /Clarification chat/);
  assert.match(frame, /Answer the questions below in one reply/);
  assert.match(frame, /\/api\/v1\/contributions\/' \+ encodeURIComponent\(state\.contributionDetail\.contribution\.id\) \+ '\/messages/);
  assert.match(frame, /new window\.EventSource\(\s*'\/api\/v1\/contributions\/' \+ encodeURIComponent\(contributionId\) \+ '\/stream'/);
  assert.match(frame, /body: uploadTarget\.draft\.file/);
  assert.match(frame, /'X-Crowdship-Attachment-Id': uploadTarget\.attachmentId/);
  assert.match(frame, /\/api\/v1\/contributions\/' \+ encodeURIComponent\(contributionId\) \+ '\/attachments/);
  assert.match(frame, /Approve Spec/);
  assert.match(frame, /Refine Spec/);
  assert.match(read('docs/widget-contract.md'), /"hostOrigin": "https:\/\/example\.aizenshtat\.eu"/);
  assert.match(read('docs/widget-contract.md'), /browser-derived host origin/i);
  assert.match(read('docs/widget-contract.md'), /POST \/api\/v1\/contributions\/:id\/messages/);
  assert.match(read('docs/widget-contract.md'), /X-Crowdship-Attachment-Id: attachment_123/);
  assert.match(read('docs/widget-contract.md'), /Content-Type: text\/csv/);
  assert.match(read('docs/widget-contract.md'), /nth created row to the nth selected file/i);
  assert.match(read('docs/widget-contract.md'), /"state": "draft_chat"/);
  assert.equal(manifest.display, 'standalone');
});

test('sentry is documented as operational merge evidence', () => {
  const sentry = read('docs/sentry.md');
  const preview = read('docs/preview-cicd.md');
  const lifecycle = read('docs/contribution-lifecycle.md');

  assert.match(sentry, /Merge-Readiness Evidence/);
  assert.match(sentry, /contribution_id/);
  assert.match(sentry, /Source map/iu);
  assert.match(preview, /No new unhandled Sentry issues/);
  assert.match(preview, /merge-readiness signal/);
  assert.match(lifecycle, /Core Review Evidence/);
});
