//! Error types for auradesk-core.
//!
//! Phase 0 keeps the surface minimal. Variants grow as services and
//! tools are added (T2–T11 of the foundation plan).

use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// Input failed schema validation, hash check, or business rule.
    #[error("validation error in {field}: {reason}")]
    Validation { field: String, reason: String },

    /// A requested entity was not found.
    #[error("{entity} not found: {id}")]
    NotFound { entity: String, id: String },

    /// A uniqueness or invariant violation.
    #[error("conflict on {entity}: {reason}")]
    Conflict { entity: String, reason: String },

    /// An internal error with a source cause (not user-recoverable).
    #[error("internal error: {source}")]
    Internal { source: String },
}

impl CoreError {
    pub fn validation(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Validation { field: field.into(), reason: reason.into() }
    }

    pub fn not_found(entity: impl Into<String>, id: impl Into<String>) -> Self {
        Self::NotFound { entity: entity.into(), id: id.into() }
    }

    pub fn conflict(entity: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Conflict { entity: entity.into(), reason: reason.into() }
    }

    pub fn internal(source: impl Into<String>) -> Self {
        Self::Internal { source: source.into() }
    }
}
