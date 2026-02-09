import { mapApi } from "./mapClient";

type ChangePayload<T> = {
  current: T[];
  previous: T[];
};

type SubscriptionCallbacks = {
  onTaskChange?: (payload: ChangePayload<unknown>) => void;
  onPhaseChange?: (payload: ChangePayload<unknown>) => void;
  onDependencyChange?: (payload: ChangePayload<unknown>) => void;
  onTransitionChange?: (payload: ChangePayload<unknown>) => void;
  onError?: (error: unknown) => void;
};

function toKey(rows: unknown[]): string {
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return "";
      const value = row as Record<string, unknown>;
      return `${String(value.id ?? "")}:${String(value.updatedAt ?? value.createdAt ?? "")}`;
    })
    .sort()
    .join("|");
}

/**
 * Sandbox-compatible realtime subscription.
 * Uses lightweight polling so multi-user edits stay in sync until DB realtime wiring is added.
 */
export function subscribeToMap(
  mapId: string,
  callbacks: SubscriptionCallbacks,
  options?: { pollMs?: number }
) {
  const pollMs = options?.pollMs ?? 3000;
  let stopped = false;
  let lastTasks: unknown[] = [];
  let lastPhases: unknown[] = [];
  let lastDeps: unknown[] = [];
  let lastTransitions: unknown[] = [];

  const tick = async () => {
    try {
      const snapshot = await mapApi.loadMap(mapId);
      if (stopped) return;

      const tasks = snapshot.tasks ?? [];
      const phases = snapshot.phases ?? [];
      const dependencies = snapshot.dependencies ?? [];
      const transitions = snapshot.transitions ?? [];

      if (toKey(tasks) !== toKey(lastTasks) && callbacks.onTaskChange) {
        callbacks.onTaskChange({ current: tasks, previous: lastTasks });
      }
      if (toKey(phases) !== toKey(lastPhases) && callbacks.onPhaseChange) {
        callbacks.onPhaseChange({ current: phases, previous: lastPhases });
      }
      if (toKey(dependencies) !== toKey(lastDeps) && callbacks.onDependencyChange) {
        callbacks.onDependencyChange({ current: dependencies, previous: lastDeps });
      }
      if (toKey(transitions) !== toKey(lastTransitions) && callbacks.onTransitionChange) {
        callbacks.onTransitionChange({ current: transitions, previous: lastTransitions });
      }

      lastTasks = tasks;
      lastPhases = phases;
      lastDeps = dependencies;
      lastTransitions = transitions;
    } catch (error) {
      callbacks.onError?.(error);
    }
  };

  const intervalId = window.setInterval(tick, pollMs);
  void tick();

  return () => {
    stopped = true;
    window.clearInterval(intervalId);
  };
}
