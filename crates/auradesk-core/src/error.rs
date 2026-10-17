//! Error types for auradesk-core.
//!
//! Phase 0 keeps the surface minimal. Variants grow as services and
//! tools are added (T2–T11 of the foundation plan).

use thiserror::Error;

/// Domain-level error. All fallible operations in `auradesk-core` return
/// `Result<_, CoreError>` so that the binary layer (Tauri, MCP) can map
/// the variant to the right IPC/JSON-RPC code.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CoreError {
    /// Input failed schema validation, hash check, or business rule.
    #[error("validation error in {field}: {reason}")]
    Validation {
        /// Name of the field that failed validation.
        field: String,
        /// Human-readable explanation of why the value is invalid.
        reason: String,
    },

    /// A requested entity was not found.
    #[error("{entity} not found: {id}")]
    NotFound {
        /// Type of entity (e.g. "task", "reminder", "project").
        entity: String,
        /// Stable identifier of the missing entity.
        id: String,
    },

    /// A uniqueness or invariant violation.
    #[error("conflict on {entity}: {reason}")]
    Conflict {
        /// Type of entity that conflicted.
        entity: String,
        /// Human-readable explanation of the invariant violated.
        reason: String,
    },

    /// An internal error with a message describing the cause (not user-recoverable).
    /// The field is named `message` (not `source`) on purpose: in thiserror,
    /// a field named `source` is treated as the `Error::source` and must
    /// implement `std::error::Error`, which `String` does not.
    #[error("internal error: {message}")]
    Internal {
        /// Description of the internal failure.
        message: String,
    },
}

impl CoreError {
    /// Construct a `Validation` variant from any `Into<String>` inputs.
    pub fn validation(field: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            reason: reason.into(),
        }
    }

    /// Construct a `NotFound` variant from any `Into<String>` inputs.
    pub fn not_found(entity: impl Into<String>, id: impl Into<String>) -> Self {
        Self::NotFound {
            entity: entity.into(),
            id: id.into(),
        }
    }

    /// Construct a `Conflict` variant from any `Into<String>` inputs.
    pub fn conflict(entity: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Conflict {
            entity: entity.into(),
            reason: reason.into(),
        }
    }

    /// Construct an `Internal` variant from any `Into<String>` message.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }
}
