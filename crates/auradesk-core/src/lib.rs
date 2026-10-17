//! AuraDesk core: framework-agnostic domain + application + infrastructure.

#![warn(missing_docs)]

pub mod error;
pub use error::CoreError;
pub mod domain;
pub mod application;
pub mod infrastructure;
pub mod capabilities;
pub mod i18n;
