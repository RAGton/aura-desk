//! AuraDesk core: framework-agnostic domain + application + infrastructure.

#![warn(missing_docs)]

pub mod error;
pub use error::CoreError;
pub mod application;
pub mod capabilities;
pub mod domain;
pub mod i18n;
pub mod infrastructure;
