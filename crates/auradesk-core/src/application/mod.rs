//! Application layer: use cases and orchestration. No I/O in this layer;
//! depends on `domain` and on `infrastructure` for persistence.

pub mod agent_runtime;
pub mod agents;
pub mod alerts;
pub mod capability_registry;
pub mod chat;
pub mod context_engine;
pub mod daily_plans;
pub mod data_io;
pub mod github;
pub mod kanban;
pub mod memories;
pub mod metrics;
pub mod pomodoros;
pub mod projects;
pub mod proposals;
pub mod reminders;
pub mod routines;
pub mod settings;
pub mod tasks;
