//! Infrastructure layer: persistence (SQLite + refinery), scheduler (tokio),
//! clock trait, audio, and the capability registry.

pub mod audio;
pub mod clock;
pub mod db;
pub mod event_bus;
pub mod migrate;
pub mod scheduler;
pub mod secret_store;
