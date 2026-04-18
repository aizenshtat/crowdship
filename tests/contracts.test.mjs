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
    '.github/workflows/smoke.yml',
    'docs/agent-tooling.md',
    'docs/ui-quality-contract.md',
    'scripts/quality-check.sh',
  ].forEach(assertFile);
});

test('ui contract preserves the hackathon quality bar', () => {
  const contract = read('docs/ui-quality-contract.md');

  assert.match(contract, /No Simulation Rule/);
  assert.match(contract, /1440x900/);
  assert.match(contract, /390x844/);
  assert.match(contract, /Keyboard/);
  assert.match(contract, /Spec approval/);
  assert.match(contract, /Preview review/);
});

test('agent skill requires concrete user-facing gates', () => {
  const skill = read('.agents/skills/crowdship-ui-ux/SKILL.md');
  const gates = read('.agents/skills/crowdship-ui-ux/references/quality-gates.md');

  assert.match(skill, /No simulation/);
  assert.match(skill, /Playwright/);
  assert.match(gates, /Desktop screenshot/);
  assert.match(gates, /Mobile screenshot/);
  assert.match(gates, /No secret values/);
});

test('package scripts expose local quality commands', () => {
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.private, true);
  assert.equal(pkg.scripts.quality, 'bash scripts/quality-check.sh');
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.mjs');
  assert.equal(pkg.scripts.lint, 'bash -n scripts/*.sh .githooks/pre-commit');
});
