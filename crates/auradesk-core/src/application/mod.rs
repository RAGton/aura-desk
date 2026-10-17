//! Application layer: use cases and orchestration. No I/O in this layer;
//! depends on `domain` and on `infrastructure` for persistence.

pub mod settings;
pub mod tasks;
pub mod projects;
pub mod kanban;
pub mod reminders;
pub mod routines;
pub mod pomodoros;
pub mod alerts;
pub mod metrics;
pub mod proposals;
pub mod daily_plans;
