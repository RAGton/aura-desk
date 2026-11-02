// React hook wrapping the IPC tasks API. Owns the in-memory list
// of tasks for the current filter, plus loading/error state.
//
// The hook re-fetches on mount and after any mutation. We don't
// subscribe to backend events (Phase 1 is single-window); if the
// data is mutated elsewhere (e.g. a future Hermes propose flow),
// the caller must invalidate manually.

import { useCallback, useEffect, useState } from "react";

import { IpcError, tasksApi, type Task, type TaskFilter } from "./ipc";

export interface UseTasks {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: typeof tasksApi.create;
  update: typeof tasksApi.update;
  remove: typeof tasksApi.delete;
  setStatus: typeof tasksApi.setStatus;
}

export function useTasks(filter: TaskFilter = {}): UseTasks {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await tasksApi.list(filter);
      setTasks(list);
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return {
    tasks,
    loading,
    error,
    refetch,
    create: async (input) => {
      const t = await tasksApi.create(input);
      await refetch();
      return t;
    },
    update: async (id, patch) => {
      const t = await tasksApi.update(id, patch);
      await refetch();
      return t;
    },
    remove: async (id) => {
      await tasksApi.delete(id);
      await refetch();
    },
    setStatus: async (input) => {
      const t = await tasksApi.setStatus(input);
      await refetch();
      return t;
    },
  };
}
