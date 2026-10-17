//! Infrastructure layer: persistence (SQLite + refinery), scheduler (tokio),
//! clock trait, audio, and the capability registry.

pub mod db;
pub mod migrate;
pub mod scheduler;
pub mod clock;
pub mod audio;
