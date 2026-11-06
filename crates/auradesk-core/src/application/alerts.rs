//! Alerts application service.

#![allow(missing_docs)]

use crate::domain::alert::{Alert, AlertResolution, AlertSeverity, NewAlert};
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Service for managing user-facing alerts.
pub struct AlertsService<'a> {
    pub db: &'a Db,
}

impl<'a> AlertsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn create(&self, new: NewAlert) -> Result<Alert, CoreError> {
        if new.title.trim().is_empty() {
            return Err(CoreError::validation("title", "blank title"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        Ok(Alert {
            id: uuid::Uuid::new_v4().to_string(),
            kind: new.kind,
            title: new.title,
            body: new.body,
            severity: new.severity,
            ref_id: new.ref_id,
            options: new.options,
            resolution: None,
            resolved_at: None,
            created_at: now,
        })
    }

    pub fn list_pending(&self) -> Result<Vec<Alert>, CoreError> {
        Ok(Vec::new())
    }

    pub fn resolve(&self, id: &str) -> Result<Alert, CoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        Ok(Alert {
            id: id.to_string(),
            kind: "routine".into(),
            title: "Resolved".into(),
            body: None,
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
            resolution: Some(AlertResolution::Resolved),
            resolved_at: Some(now.clone()),
            created_at: now,
        })
    }

    pub fn snooze(&self, id: &str) -> Result<Alert, CoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        Ok(Alert {
            id: id.to_string(),
            kind: "routine".into(),
            title: "Snoozed".into(),
            body: None,
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
            resolution: Some(AlertResolution::Snoozed),
            resolved_at: Some(now.clone()),
            created_at: now,
        })
    }

    pub fn dismiss(&self, id: &str) -> Result<Alert, CoreError> {
        let now = chrono::Utc::now().to_rfc3339();
        Ok(Alert {
            id: id.to_string(),
            kind: "routine".into(),
            title: "Dismissed".into(),
            body: None,
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
            resolution: Some(AlertResolution::Dismissed),
            resolved_at: Some(now.clone()),
            created_at: now,
        })
    }

    pub fn except(&self, id: &str, note: &str) -> Result<Alert, CoreError> {
        if note.trim().is_empty() {
            return Err(CoreError::validation("note", "empty note"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        Ok(Alert {
            id: id.to_string(),
            kind: "routine".into(),
            title: "Excepted".into(),
            body: Some(note.to_string()),
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
            resolution: Some(AlertResolution::Excepted),
            resolved_at: Some(now.clone()),
            created_at: now,
        })
    }
}
