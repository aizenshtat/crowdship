export const ADMIN_NOTIFICATION_STORAGE_KEY = 'crowdship.admin.notifications.v1';
export const ADMIN_NOTIFICATION_POLL_INTERVAL_MS = 60_000;

const DEFAULT_QUIET_MODE_START = '22:00';
const DEFAULT_QUIET_MODE_END = '08:00';
const ADMIN_NOTIFICATION_ICON = '/icons/icon-192.png';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export type ProjectNotificationOption = {
  slug: string;
  label: string;
};

export type NotificationProjectPreference = {
  enabled: boolean;
  label: string;
};

export type NotificationSettings = {
  enabled: boolean;
  quietMode: {
    enabled: boolean;
    start: string;
    end: string;
  };
  projects: Record<string, NotificationProjectPreference>;
};

export type ContributionNotificationCandidate = {
  id: string;
  projectSlug?: string | null;
  title: string;
  state: string;
  updatedAt: string;
};

export type AdminNotificationEvent = {
  contributionId: string;
  projectSlug: string;
  state: string;
  tag: string;
  title: string;
  body: string;
  url: string;
};

type NotificationSignal =
  | 'spec_pending_approval'
  | 'preview_ready'
  | 'revision_requested'
  | 'ready_for_voting'
  | 'core_review'
  | 'completed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type BadgeApi = {
  setAppBadge?: (count?: number) => Promise<void> | void;
  clearAppBadge?: () => Promise<void> | void;
};

type ServiceWorkerLike = {
  register?: (scriptUrl: string) => Promise<unknown>;
  ready?: Promise<{
    showNotification?: (title: string, options?: Record<string, unknown>) => Promise<void> | void;
  }>;
};

type NotificationConstructorLike = {
  new (title: string, options?: Record<string, unknown>): unknown;
  permission: NotificationPermissionState;
  requestPermission?: () => Promise<NotificationPermissionState>;
};

function asObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readBooleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function readStringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeProjectSlug(value: string | null | undefined) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || 'default';
}

function fallbackProjectLabel(slug: string) {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || slug;
}

function isTimeValue(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match);
}

function normalizeQuietTime(value: unknown, fallbackValue: string) {
  const normalized = readStringValue(value).trim();
  return isTimeValue(normalized) ? normalized : fallbackValue;
}

function quietTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return hours * 60 + minutes;
}

function getNotificationSignal(state: string): NotificationSignal | null {
  switch (state) {
    case 'spec_pending_approval':
      return 'spec_pending_approval';
    case 'preview_ready':
      return 'preview_ready';
    case 'revision_requested':
    case 'requester_review':
      return 'revision_requested';
    case 'ready_for_voting':
    case 'voting_open':
      return 'ready_for_voting';
    case 'core_team_flagged':
    case 'core_review':
      return 'core_review';
    case 'completed':
      return 'completed';
    default:
      return null;
  }
}

function buildContributionNotificationEvent(item: ContributionNotificationCandidate): AdminNotificationEvent | null {
  const signal = getNotificationSignal(item.state);

  if (!signal) {
    return null;
  }

  const projectSlug = normalizeProjectSlug(item.projectSlug);
  const url = `/?section=inbox&contribution=${encodeURIComponent(item.id)}`;

  switch (signal) {
    case 'spec_pending_approval':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:spec`,
        title: 'Spec needs approval',
        body: `${item.title} is ready for owner review.`,
        url,
      };
    case 'preview_ready':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:preview`,
        title: 'Preview ready',
        body: `${item.title} has a preview ready for review.`,
        url,
      };
    case 'revision_requested':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:revision`,
        title: 'Revision requested',
        body: `${item.title} needs another pass before it can move forward.`,
        url,
      };
    case 'ready_for_voting':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:vote`,
        title: 'Voting is ready',
        body: `${item.title} is ready for the next decision round.`,
        url,
      };
    case 'core_review':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:core-review`,
        title: 'Core review needed',
        body: `${item.title} is waiting on core review.`,
        url,
      };
    case 'completed':
      return {
        contributionId: item.id,
        projectSlug,
        state: item.state,
        tag: `crowdship:${item.id}:completed`,
        title: 'Production shipped',
        body: `${item.title} is marked completed.`,
        url,
      };
  }
}

export function mergeProjectNotificationOptions(projects: ProjectNotificationOption[]) {
  const knownProjects = new Map<string, ProjectNotificationOption>();

  for (const project of projects) {
    const slug = normalizeProjectSlug(project.slug);
    if (!knownProjects.has(slug)) {
      knownProjects.set(slug, {
        slug,
        label: project.label.trim() || fallbackProjectLabel(slug),
      });
      continue;
    }

    const existing = knownProjects.get(slug);
    if (existing && existing.label === fallbackProjectLabel(slug) && project.label.trim().length > 0) {
      knownProjects.set(slug, {
        slug,
        label: project.label.trim(),
      });
    }
  }

  return Array.from(knownProjects.values());
}

export function createDefaultNotificationSettings(projects: ProjectNotificationOption[]): NotificationSettings {
  const normalizedProjects = mergeProjectNotificationOptions(projects);

  return {
    enabled: false,
    quietMode: {
      enabled: false,
      start: DEFAULT_QUIET_MODE_START,
      end: DEFAULT_QUIET_MODE_END,
    },
    projects: Object.fromEntries(
      normalizedProjects.map((project) => [
        project.slug,
        {
          enabled: true,
          label: project.label,
        },
      ]),
    ),
  };
}

export function syncNotificationSettings(
  value: unknown,
  projects: ProjectNotificationOption[],
): NotificationSettings {
  const normalizedProjects = mergeProjectNotificationOptions(projects);
  const source = asObject(value);
  const projectSource = asObject(source.projects);
  const defaultSettings = createDefaultNotificationSettings(normalizedProjects);
  const nextProjects: Record<string, NotificationProjectPreference> = {};

  for (const [slug, preference] of Object.entries(projectSource)) {
    const normalizedSlug = normalizeProjectSlug(slug);
    const knownProject = normalizedProjects.find((project) => project.slug === normalizedSlug);
    const sourcePreference = asObject(preference);

    nextProjects[normalizedSlug] = {
      enabled: readBooleanValue(sourcePreference.enabled) ?? true,
      label:
        readStringValue(sourcePreference.label).trim() ||
        knownProject?.label ||
        fallbackProjectLabel(normalizedSlug),
    };
  }

  for (const project of normalizedProjects) {
    if (!nextProjects[project.slug]) {
      nextProjects[project.slug] = {
        enabled: true,
        label: project.label,
      };
    } else if (!nextProjects[project.slug].label.trim()) {
      nextProjects[project.slug].label = project.label;
    }
  }

  return {
    enabled: readBooleanValue(source.enabled) ?? defaultSettings.enabled,
    quietMode: {
      enabled: readBooleanValue(asObject(source.quietMode).enabled) ?? defaultSettings.quietMode.enabled,
      start: normalizeQuietTime(asObject(source.quietMode).start, defaultSettings.quietMode.start),
      end: normalizeQuietTime(asObject(source.quietMode).end, defaultSettings.quietMode.end),
    },
    projects: nextProjects,
  };
}

export function loadNotificationSettings(storage: StorageLike | null | undefined, projects: ProjectNotificationOption[]) {
  if (!storage) {
    return createDefaultNotificationSettings(projects);
  }

  try {
    const storedValue = storage.getItem(ADMIN_NOTIFICATION_STORAGE_KEY);
    if (!storedValue) {
      return createDefaultNotificationSettings(projects);
    }

    return syncNotificationSettings(JSON.parse(storedValue) as unknown, projects);
  } catch {
    return createDefaultNotificationSettings(projects);
  }
}

export function persistNotificationSettings(storage: StorageLike | null | undefined, settings: NotificationSettings) {
  if (!storage) {
    return;
  }

  storage.setItem(ADMIN_NOTIFICATION_STORAGE_KEY, JSON.stringify(settings));
}

export function isQuietModeActive(settings: NotificationSettings, now = new Date()) {
  if (!settings.enabled || !settings.quietMode.enabled) {
    return false;
  }

  const startMinutes = quietTimeToMinutes(settings.quietMode.start);
  const endMinutes = quietTimeToMinutes(settings.quietMode.end);

  if (startMinutes === endMinutes) {
    return true;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function isActionableContributionState(state: string) {
  return getNotificationSignal(state) !== null;
}

export function deriveContributionNotificationEvents(
  previousItems: ContributionNotificationCandidate[],
  nextItems: ContributionNotificationCandidate[],
  settings: NotificationSettings,
) {
  if (!settings.enabled) {
    return [];
  }

  const previousSignals = new Map(
    previousItems.map((item) => [item.id, getNotificationSignal(item.state)]),
  );

  return nextItems.flatMap((item) => {
    const projectSlug = normalizeProjectSlug(item.projectSlug);
    const projectPreference = settings.projects[projectSlug];

    if (!projectPreference?.enabled) {
      return [];
    }

    const nextSignal = getNotificationSignal(item.state);
    if (!nextSignal) {
      return [];
    }

    const previousSignal = previousSignals.get(item.id) ?? null;
    if (previousSignal === nextSignal) {
      return [];
    }

    const nextEvent = buildContributionNotificationEvent(item);
    return nextEvent ? [nextEvent] : [];
  });
}

export function countActionableNotifications(
  items: ContributionNotificationCandidate[],
  settings: NotificationSettings,
) {
  if (!settings.enabled) {
    return 0;
  }

  return items.reduce((count, item) => {
    const projectSlug = normalizeProjectSlug(item.projectSlug);
    if (!settings.projects[projectSlug]?.enabled) {
      return count;
    }

    return isActionableContributionState(item.state) ? count + 1 : count;
  }, 0);
}

export function getBrowserNotificationPermission(
  notificationCtor: NotificationConstructorLike | undefined = globalThis.Notification as
    | NotificationConstructorLike
    | undefined,
): NotificationPermissionState {
  return notificationCtor?.permission ?? 'unsupported';
}

export async function requestBrowserNotificationPermission(
  notificationCtor: NotificationConstructorLike | undefined = globalThis.Notification as
    | NotificationConstructorLike
    | undefined,
) {
  if (!notificationCtor?.requestPermission) {
    return 'unsupported';
  }

  return notificationCtor.requestPermission();
}

export async function deliverAdminNotification(
  event: AdminNotificationEvent,
  {
    serviceWorker = globalThis.navigator?.serviceWorker as ServiceWorkerLike | undefined,
    notificationCtor = globalThis.Notification as NotificationConstructorLike | undefined,
  }: {
    serviceWorker?: ServiceWorkerLike | undefined;
    notificationCtor?: NotificationConstructorLike | undefined;
  } = {},
) {
  if (serviceWorker?.ready) {
    const registration = await serviceWorker.ready;
    if (typeof registration?.showNotification === 'function') {
      await registration.showNotification(event.title, {
        body: event.body,
        tag: event.tag,
        badge: ADMIN_NOTIFICATION_ICON,
        icon: ADMIN_NOTIFICATION_ICON,
        data: {
          contributionId: event.contributionId,
          projectSlug: event.projectSlug,
          state: event.state,
          url: event.url,
        },
      });
      return 'service_worker';
    }
  }

  if (notificationCtor) {
    new notificationCtor(event.title, {
      body: event.body,
      tag: event.tag,
      icon: ADMIN_NOTIFICATION_ICON,
      data: {
        contributionId: event.contributionId,
        projectSlug: event.projectSlug,
        state: event.state,
        url: event.url,
      },
    });
    return 'window';
  }

  return 'unsupported';
}

export async function syncAdminBadgeCount(
  count: number,
  badgeApi: BadgeApi | undefined = globalThis.navigator as BadgeApi | undefined,
) {
  if (!badgeApi) {
    return false;
  }

  if (count > 0 && typeof badgeApi.setAppBadge === 'function') {
    await badgeApi.setAppBadge(count);
    return true;
  }

  if (count <= 0 && typeof badgeApi.clearAppBadge === 'function') {
    await badgeApi.clearAppBadge();
    return true;
  }

  return false;
}

export function registerAdminServiceWorker(serviceWorker = globalThis.navigator?.serviceWorker as ServiceWorkerLike | undefined) {
  if (!serviceWorker?.register) {
    return Promise.resolve(null);
  }

  return serviceWorker.register('/sw.js');
}
