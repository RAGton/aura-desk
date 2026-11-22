//! Settings keys: the canonical, exhaustive list of keys that may be
//! written to the `settings` table.
//!
//! Writes to `settings` are gated through this enum at the application
//! layer: any key not listed here returns `CoreError::Validation`.
//! This prevents typos like `pomodoro.focus_minn` from silently
//! creating new rows.

use serde::{Deserialize, Serialize};

/// All settings keys, matching the defaults seeded by V001/V002.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SettingsKey {
    /// Running app version (string, e.g. "0.1.0").
    AppVersion,
    /// UI theme preference ("light" | "dark" | "system").
    AppTheme,
    /// Active UI locale code (e.g. "pt-BR", "en").
    AppLocale,
    /// Whether AuraDesk launches automatically at OS login.
    AppAutostart,
    /// Whether the floating always-on-top compact widget is enabled.
    DesktopCompactMode,
    /// Dashboard auto-refresh interval in seconds.
    DashboardRefreshSec,
    /// Preferred external monitor name for full-screen dashboard.
    MonitorPreferred,
    /// What to do when `MonitorPreferred` is disconnected.
    MonitorFallbackStrategy,
    /// Whether reminder sound effects are enabled.
    RemindersSound,
    /// Whether desktop alerts lock the screen with a full-screen blocking modal until read.
    RemindersBlockScreen,
    /// Until when reminders are snoozed (ISO-8601 string or null).
    RemindersPausedUntil,
    /// Focus phase duration in minutes.
    PomodoroFocusMin,
    /// Short break duration in minutes.
    PomodoroShortMin,
    /// Long break duration in minutes.
    PomodoroLongMin,
    /// Number of focus phases before a long break.
    PomodoroCyclesToLong,
    /// Local time of the daily planning routine (e.g. "07:50").
    RoutineDailyPlanningTime,
    /// Hydration reminder interval in minutes.
    RoutineWaterIntervalMin,
    /// Break reminder interval in minutes.
    RoutineBreakIntervalMin,
    /// Maximum number of alerts kept in the queue.
    AlertsMaxQueueSize,
    /// Time-to-live for pending IA proposals in hours.
    ProposalsTtlHours,
    /// Canonical GitHub repository ("owner/repo").
    GithubRepo,
    /// Target project ID to which GitHub issues are imported.
    GithubProjectId,
    /// Comma-separated list of GitHub labels to filter.
    GithubFilterLabels,
    /// Whether background auto-sync is enabled.
    GithubAutoSync,
    /// Whether AuraDesk automatically checks, downloads, and installs GitHub updates.
    UpdatesAutoUpdate,
    /// OS inactivity threshold in minutes before user is considered idle.
    DesktopIdleThresholdMin,
    /// Whether an active Pomodoro session automatically pauses when the user goes idle.
    DesktopIdleAutoPausePomodoro,
    /// Whether periodic water/break routine alerts are suppressed while the user is idle.
    DesktopIdleSuppressRoutines,
    /// Active AI provider backend ("auto", "openai", "minimax", "ollama", "openrouter", "hermes_cli", "codex_cli", "custom", "offline").
    AiProvider,
    /// Optional OpenAI-compatible API base URL override.
    AiBaseUrl,
    /// Optional AI model override (e.g. "MiniMax-M1", "gpt-4.1-mini", "llama3.2").
    AiModel,
    /// Optional API key for the configured HTTP AI provider.
    AiApiKey,
    /// Optional custom persona instructions appended to Aura's system prompt.
    AiSystemPrompt,
    /// Whether RAGLight document/file retrieval is enabled for Aura.
    RaglightEnabled,
    /// RAGLight deployment mode ("managed_local" | "external_url").
    RaglightMode,
    /// RAGLight HTTP server URL (local or cloud/remote).
    RaglightBaseUrl,
    /// Optional API key for RAGLight cloud/remote server or paid provider.
    RaglightApiKey,
    /// Provider used by the managed RAGLight pipeline ("ollama" | "openai" | "gemini" | "mistral" | "vllm" | "lmstudio").
    RaglightProvider,
    /// Embedding model used by RAGLight.
    RaglightEmbeddingModel,
    /// LLM model used by RAGLight.
    RaglightLlmModel,
    /// Vector store backend used by RAGLight ("chroma" | "qdrant").
    RaglightVectorStore,
    /// Semicolon- or newline-separated list of local folders indexed by RAGLight.
    RaglightFolders,
    /// Whether Hindsight episodic/semantic memory integration is enabled.
    HindsightEnabled,
    /// Base URL for the Hindsight memory HTTP server.
    HindsightBaseUrl,
    /// Default Hindsight memory bank identifier for Aura.
    HindsightDefaultBank,
    /// Whether AuraDesk automatically creates area/project banks in Hindsight on demand.
    HindsightAutoCreateBanks,
    /// Whether AuraDesk runs daily memory consolidation and DB optimization automatically.
    HindsightDailyMaintenance,
    /// UTC date (YYYY-MM-DD) of the last completed daily memory maintenance run.
    HindsightLastMaintenanceDate,
}

impl SettingsKey {
    /// String form stored in `settings.key`. Keep stable: changing the
    /// string is a migration.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AppVersion => "app.version",
            Self::AppTheme => "app.theme",
            Self::AppLocale => "app.locale",
            Self::AppAutostart => "app.autostart",
            Self::DesktopCompactMode => "desktop.compact_mode",
            Self::DashboardRefreshSec => "dashboard.refresh_sec",
            Self::MonitorPreferred => "monitor.preferred",
            Self::MonitorFallbackStrategy => "monitor.fallback_strategy",
            Self::RemindersSound => "reminders.sound",
            Self::RemindersBlockScreen => "reminders.block_screen",
            Self::RemindersPausedUntil => "reminders.paused_until",
            Self::PomodoroFocusMin => "pomodoro.focus_min",
            Self::PomodoroShortMin => "pomodoro.short_min",
            Self::PomodoroLongMin => "pomodoro.long_min",
            Self::PomodoroCyclesToLong => "pomodoro.cycles_to_long",
            Self::RoutineDailyPlanningTime => "routine.daily_planning_time",
            Self::RoutineWaterIntervalMin => "routine.water_interval_min",
            Self::RoutineBreakIntervalMin => "routine.break_interval_min",
            Self::AlertsMaxQueueSize => "alerts.max_queue_size",
            Self::ProposalsTtlHours => "proposals.ttl_hours",
            Self::GithubRepo => "github.repo",
            Self::GithubProjectId => "github.project_id",
            Self::GithubFilterLabels => "github.filter_labels",
            Self::GithubAutoSync => "github.auto_sync",
            Self::UpdatesAutoUpdate => "updates.auto_update",
            Self::DesktopIdleThresholdMin => "desktop.idle_threshold_min",
            Self::DesktopIdleAutoPausePomodoro => "desktop.idle_auto_pause_pomodoro",
            Self::DesktopIdleSuppressRoutines => "desktop.idle_suppress_routines",
            Self::AiProvider => "ai.provider",
            Self::AiBaseUrl => "ai.base_url",
            Self::AiModel => "ai.model",
            Self::AiApiKey => "ai.api_key",
            Self::AiSystemPrompt => "ai.system_prompt",
            Self::RaglightEnabled => "raglight.enabled",
            Self::RaglightMode => "raglight.mode",
            Self::RaglightBaseUrl => "raglight.base_url",
            Self::RaglightApiKey => "raglight.api_key",
            Self::RaglightProvider => "raglight.provider",
            Self::RaglightEmbeddingModel => "raglight.embedding_model",
            Self::RaglightLlmModel => "raglight.llm_model",
            Self::RaglightVectorStore => "raglight.vector_store",
            Self::RaglightFolders => "raglight.folders",
            Self::HindsightEnabled => "hindsight.enabled",
            Self::HindsightBaseUrl => "hindsight.base_url",
            Self::HindsightDefaultBank => "hindsight.default_bank",
            Self::HindsightAutoCreateBanks => "hindsight.auto_create_banks",
            Self::HindsightDailyMaintenance => "hindsight.daily_maintenance",
            Self::HindsightLastMaintenanceDate => "hindsight.last_maintenance_date",
        }
    }

    /// Parse from the string form. Returns `None` for unknown keys.
    ///
    /// Not named `from_str` via `FromStr` because the public surface
    /// returns `Option<Self>` (not `Result<Self, _>`). The signature is
    /// preserved intentionally; `#[allow(clippy::should_implement_trait)]`
    /// documents the deliberate non-conformance.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "app.version" => Self::AppVersion,
            "app.theme" => Self::AppTheme,
            "app.locale" => Self::AppLocale,
            "app.autostart" => Self::AppAutostart,
            "desktop.compact_mode" => Self::DesktopCompactMode,
            "dashboard.refresh_sec" => Self::DashboardRefreshSec,
            "monitor.preferred" => Self::MonitorPreferred,
            "monitor.fallback_strategy" => Self::MonitorFallbackStrategy,
            "reminders.sound" => Self::RemindersSound,
            "reminders.block_screen" => Self::RemindersBlockScreen,
            "reminders.paused_until" => Self::RemindersPausedUntil,
            "pomodoro.focus_min" => Self::PomodoroFocusMin,
            "pomodoro.short_min" => Self::PomodoroShortMin,
            "pomodoro.long_min" => Self::PomodoroLongMin,
            "pomodoro.cycles_to_long" => Self::PomodoroCyclesToLong,
            "routine.daily_planning_time" => Self::RoutineDailyPlanningTime,
            "routine.water_interval_min" => Self::RoutineWaterIntervalMin,
            "routine.break_interval_min" => Self::RoutineBreakIntervalMin,
            "alerts.max_queue_size" => Self::AlertsMaxQueueSize,
            "proposals.ttl_hours" => Self::ProposalsTtlHours,
            "github.repo" => Self::GithubRepo,
            "github.project_id" => Self::GithubProjectId,
            "github.filter_labels" => Self::GithubFilterLabels,
            "github.auto_sync" => Self::GithubAutoSync,
            "updates.auto_update" => Self::UpdatesAutoUpdate,
            "desktop.idle_threshold_min" => Self::DesktopIdleThresholdMin,
            "desktop.idle_auto_pause_pomodoro" => Self::DesktopIdleAutoPausePomodoro,
            "desktop.idle_suppress_routines" => Self::DesktopIdleSuppressRoutines,
            "ai.provider" => Self::AiProvider,
            "ai.base_url" => Self::AiBaseUrl,
            "ai.model" => Self::AiModel,
            "ai.api_key" => Self::AiApiKey,
            "ai.system_prompt" => Self::AiSystemPrompt,
            "raglight.enabled" => Self::RaglightEnabled,
            "raglight.mode" => Self::RaglightMode,
            "raglight.base_url" => Self::RaglightBaseUrl,
            "raglight.api_key" => Self::RaglightApiKey,
            "raglight.provider" => Self::RaglightProvider,
            "raglight.embedding_model" => Self::RaglightEmbeddingModel,
            "raglight.llm_model" => Self::RaglightLlmModel,
            "raglight.vector_store" => Self::RaglightVectorStore,
            "raglight.folders" => Self::RaglightFolders,
            "hindsight.enabled" => Self::HindsightEnabled,
            "hindsight.base_url" => Self::HindsightBaseUrl,
            "hindsight.default_bank" => Self::HindsightDefaultBank,
            "hindsight.auto_create_banks" => Self::HindsightAutoCreateBanks,
            "hindsight.daily_maintenance" => Self::HindsightDailyMaintenance,
            "hindsight.last_maintenance_date" => Self::HindsightLastMaintenanceDate,
            _ => return None,
        })
    }

    /// Keys whose value is a credential (API key, token, secret).
    ///
    /// These are never written to a backup export in plaintext. See
    /// [`crate::application::data_io`] for the redaction rules.
    ///
    /// This const is the single source of truth for "which settings are
    /// secrets" — callers must not compare raw key strings.
    pub const SENSITIVE: &'static [SettingsKey] = &[Self::AiApiKey, Self::RaglightApiKey];

    /// Whether this key holds a credential that must be redacted on export.
    ///
    /// Prefer [`Self::SENSITIVE`] when iterating over several keys.
    pub fn is_sensitive(&self) -> bool {
        Self::SENSITIVE.contains(self)
    }

    /// All keys, in stable order. Used by `SettingsService::get_all` and
    /// by tooling that wants to enumerate the canonical set.
    pub const ALL: &'static [SettingsKey] = &[
        Self::AppVersion,
        Self::AppTheme,
        Self::AppLocale,
        Self::AppAutostart,
        Self::DesktopCompactMode,
        Self::DashboardRefreshSec,
        Self::MonitorPreferred,
        Self::MonitorFallbackStrategy,
        Self::RemindersSound,
        Self::RemindersBlockScreen,
        Self::RemindersPausedUntil,
        Self::PomodoroFocusMin,
        Self::PomodoroShortMin,
        Self::PomodoroLongMin,
        Self::PomodoroCyclesToLong,
        Self::RoutineDailyPlanningTime,
        Self::RoutineWaterIntervalMin,
        Self::RoutineBreakIntervalMin,
        Self::AlertsMaxQueueSize,
        Self::ProposalsTtlHours,
        Self::GithubRepo,
        Self::GithubProjectId,
        Self::GithubFilterLabels,
        Self::GithubAutoSync,
        Self::UpdatesAutoUpdate,
        Self::DesktopIdleThresholdMin,
        Self::DesktopIdleAutoPausePomodoro,
        Self::DesktopIdleSuppressRoutines,
        Self::AiProvider,
        Self::AiBaseUrl,
        Self::AiModel,
        Self::AiApiKey,
        Self::AiSystemPrompt,
        Self::RaglightEnabled,
        Self::RaglightMode,
        Self::RaglightBaseUrl,
        Self::RaglightApiKey,
        Self::RaglightProvider,
        Self::RaglightEmbeddingModel,
        Self::RaglightLlmModel,
        Self::RaglightVectorStore,
        Self::RaglightFolders,
        Self::HindsightEnabled,
        Self::HindsightBaseUrl,
        Self::HindsightDefaultBank,
        Self::HindsightAutoCreateBanks,
        Self::HindsightDailyMaintenance,
        Self::HindsightLastMaintenanceDate,
    ];
}
