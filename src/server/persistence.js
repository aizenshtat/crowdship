function cloneRecord(record) {
  return {
    ...record,
    payload: record.payload == null ? record.payload : structuredClone(record.payload),
  };
}

function cloneProgressEvent(event) {
  return {
    ...event,
    payload: event.payload == null ? event.payload : structuredClone(event.payload),
  };
}

function toIsoTimestamp(clock) {
  const value = typeof clock === 'function' ? clock() : clock;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

export function createInMemoryContributionPersistenceAdapter({
  clock = () => new Date(),
} = {}) {
  const contributions = new Map();
  const progressEvents = new Map();

  function getStoredContribution(contributionId) {
    const contribution = contributions.get(contributionId);
    return contribution ? cloneRecord(contribution) : null;
  }

  function getStoredProgressEvents(contributionId) {
    const events = progressEvents.get(contributionId);
    return events ? events.map((event) => cloneProgressEvent(event)) : null;
  }

  return {
    connected: true,
    kind: 'in-memory-contribution-persistence',
    listContributions() {
      return Array.from(contributions.values()).map((contribution) => cloneRecord(contribution));
    },
    createContribution({ contribution, progressEvent }) {
      const contributionId = contribution.id;
      contributions.set(contributionId, cloneRecord(contribution));
      progressEvents.set(contributionId, [cloneProgressEvent(progressEvent)]);

      return {
        contribution: getStoredContribution(contributionId),
        progressEvents: getStoredProgressEvents(contributionId),
      };
    },
    getContribution(contributionId) {
      return getStoredContribution(contributionId);
    },
    getContributionProgress(contributionId) {
      const contribution = getStoredContribution(contributionId);
      const events = getStoredProgressEvents(contributionId);

      if (!contribution || !events) {
        return null;
      }

      return {
        contribution,
        progressEvents: events,
      };
    },
    appendContributionProgressEvent(contributionId, progressEvent) {
      if (!contributions.has(contributionId)) {
        return null;
      }

      const nextEvent = cloneProgressEvent(progressEvent);
      const existingEvents = progressEvents.get(contributionId) ?? [];
      existingEvents.push(nextEvent);
      progressEvents.set(contributionId, existingEvents);

      const contribution = contributions.get(contributionId);
      contributions.set(contributionId, {
        ...contribution,
        updatedAt: nextEvent.createdAt ?? toIsoTimestamp(clock),
      });

      return cloneProgressEvent(nextEvent);
    },
  };
}
