// Phase 3 smoke: AlertsService lifecycle (list pending, resolve, snooze,
// dismiss). The persistent modal calls these via the IPC; tests
// exercise the same paths the production UI does.

use auradesk_core::application::alerts::AlertsService;
use auradesk_core::domain::alert::{AlertResolution, AlertSeverity, NewAlert};
use auradesk_core::infrastructure::db::Db;
use std::sync::Arc;

#[test]
fn alerts_lifecycle_resolve_dismiss_snooze() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let svc = AlertsService::new(&db);

    let a1 = svc
        .create(NewAlert {
            kind: "routine".into(),
            title: "Beber água".into(),
            body: Some("250ml".into()),
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
        })
        .unwrap();
    let a2 = svc
        .create(NewAlert {
            kind: "pomodoro".into(),
            title: "✓ Foco concluído".into(),
            body: None,
            severity: AlertSeverity::Normal,
            ref_id: None,
            options: None,
        })
        .unwrap();

    // Both show as pending.
    let pending = svc.list_pending().unwrap();
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().any(|a| a.id == a1.id));

    // Resolve a1.
    let resolved = svc.resolve(&a1.id).unwrap();
    assert_eq!(resolved.resolution, Some(AlertResolution::Resolved));
    assert!(resolved.resolved_at.is_some());
    let pending = svc.list_pending().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, a2.id);

    // Snooze a2: the alert is hidden from `list_pending` (resolved
    // is set), but stored for re-fire.
    let snoozed = svc.snooze(&a2.id).unwrap();
    assert_eq!(snoozed.resolution, Some(AlertResolution::Snoozed));
    let pending = svc.list_pending().unwrap();
    assert!(pending.is_empty());

    // Re-create an alert and dismiss it.
    let a3 = svc
        .create(NewAlert {
            kind: "routine".into(),
            title: "Alongar".into(),
            body: None,
            severity: AlertSeverity::Info,
            ref_id: None,
            options: None,
        })
        .unwrap();
    let dismissed = svc.dismiss(&a3.id).unwrap();
    assert_eq!(dismissed.resolution, Some(AlertResolution::Dismissed));
    assert!(svc.list_pending().unwrap().is_empty());
}

#[test]
fn alerts_create_rejects_empty_title() {
    let db = Arc::new(Db::open_in_memory().unwrap());
    let svc = AlertsService::new(&db);
    let err = svc
        .create(NewAlert {
            kind: "x".into(),
            title: "   ".into(),
            body: None,
            severity: AlertSeverity::Info,
            ref_id: None,
            options: None,
        })
        .unwrap_err();
    assert!(format!("{err:?}").contains("Validation"));
}
