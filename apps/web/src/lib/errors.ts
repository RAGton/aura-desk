import i18n from "./i18n";

/**
 * Error messages raised by the browser fallback.
 *
 * The backend answers in the user's language through its own locale files;
 * the browser fallback has no backend, so it resolves the same wording
 * here from the frontend locale files. Keys live under `errors.*`.
 */
export const ERROR_KEYS = {
  taskTitleEmpty: "errors.taskTitleEmpty",
  taskTitleInvalid: "errors.taskTitleInvalid",
  projectNameRequired: "errors.projectNameRequired",
  pomodoroNotRunning: "errors.pomodoroNotRunning",
  pomodoroNoneActive: "errors.pomodoroNoneActive",
  focusCompletedBody: "errors.focusCompletedBody",
  reminderTitleRequired: "errors.reminderTitleRequired",
  exceptionNoteRequired: "errors.exceptionNoteRequired",
} as const;

/** Resolve an error key to the message in the active locale. */
export function errorMessage(key: string): string {
  return i18n.t(key);
}
