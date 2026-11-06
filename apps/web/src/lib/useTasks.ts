// React hook wrapping the IPC tasks API. Owns the in-memory list
// of tasks for the current filter, plus loading/error state.
//
// The hook re-fetches on mount and after any mutation. We don't
// subscribe to backend events (Phase 1 is single-window); if the
// data is mutated elsewhere (e.g. a future Hermes propose flow),
// the caller must invalidate manually.

import { useCallback, useEffect, useState } from "react";

import {
  IpcError,
  tasksApi,
  type CreateTaskInput,
  type SetStatusInput,
  type Task,
  type TaskFilter,
  type UpdateTaskInput,
} from "./ipc";

export interface UseTasks {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  create: (input: CreateTaskInput) => Promise<Task>;
  update: (id: string, patch: UpdateTaskInput) => Promise<Task>;
  remove: (id: string) => Promise<void>;
  setStatus: (input: SetStatusInput) => Promise<Task>;
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
    create: async (input: CreateTaskInput) => {
      const t = await tasksApi.create(input);
      await refetch();
      return t;
    },
    update: async (id: string, patch: UpdateTaskInput) => {
      const t = await tasksApi.update(id, patch);
      await refetch();
      return t;
    },
    remove: async (id: string) => {
      await tasksApi.delete(id);
      await refetch();
    },
    setStatus: async (input: SetStatusInput) => {
      const t = await tasksApi.setStatus(input);
      await refetch();
      return t;
    },
  };
}
