export function slugifySegment(value, fallback = 'change') {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return normalized || fallback;
}

export function buildBranchName(contributionId, title) {
  return `crowdship/${contributionId}-${slugifySegment(title)}`.slice(0, 120);
}

export function buildPullRequestTitle(title) {
  return `Crowdship: ${title}`;
}

export function buildPreviewUrl(exampleBaseUrl, contributionId) {
  const normalizedBase = String(exampleBaseUrl ?? '').replace(/\/+$/, '');
  return `${normalizedBase}/previews/${encodeURIComponent(contributionId)}/`;
}

export function buildContributionArtifact(detail) {
  const latestSpec = detail.specVersions
    .slice()
    .sort((left, right) => right.versionNumber - left.versionNumber)[0];

  const acceptanceCriteria = (latestSpec?.spec?.acceptanceCriteria ?? [])
    .map((item) => `- ${item}`)
    .join('\n');
  const nonGoals = (latestSpec?.spec?.nonGoals ?? [])
    .map((item) => `- ${item}`)
    .join('\n');

  return `# Crowdship Contribution ${detail.contribution.id}

## Title

${detail.contribution.title}

## State

${detail.contribution.state}

## Route

${detail.contribution.payload?.route ?? 'Not provided'}

## User Problem

${latestSpec?.userProblem ?? detail.contribution.body ?? detail.contribution.title}

## Goal

${latestSpec?.goal ?? detail.contribution.title}

## Acceptance Criteria

${acceptanceCriteria || '- None recorded'}

## Non-Goals

${nonGoals || '- None recorded'}
`;
}

export function buildPullRequestBody({
  contributionId,
  contributionTitle,
  crowdshipBaseUrl,
  acceptanceCriteria = [],
  previewUrl = null,
  verification = [],
}) {
  const criteriaSection =
    acceptanceCriteria.length > 0
      ? acceptanceCriteria.map((item) => `- ${item}`).join('\n')
      : '- None recorded';
  const verificationSection =
    verification.length > 0
      ? verification.map((item) => `- ${item}`).join('\n')
      : '- Not run';
  const previewSection = previewUrl ? previewUrl : 'Not deployed yet';
  const adminUrl = `${String(crowdshipBaseUrl ?? '').replace(/\/+$/, '')}/?contribution=${encodeURIComponent(contributionId)}`;

  return `## Crowdship Contribution

- Contribution ID: \`${contributionId}\`
- Title: ${contributionTitle}
- Crowdship admin: ${adminUrl}

## Acceptance Criteria

${criteriaSection}

## Verification

${verificationSection}

## Preview

${previewSection}
`;
}
