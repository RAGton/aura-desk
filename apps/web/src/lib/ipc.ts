import { invoke } from "@tauri-apps/api/core";

// Phase 0 T7: stub. Real IPC commands are added in T1+ as the
// application services grow. The wrapper exists so frontend code
// can already import typed handlers that return Promise<T>.
export const ipc = {
  ping: () => invoke<string>("ping"),
} as const;
