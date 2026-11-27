use std::path::PathBuf;
use auradesk_core::application::plugins::{ExecutePluginActionInput, PluginManager};
use auradesk_core::domain::plugin::NormalizedPluginEvent;
use auradesk_core::infrastructure::db::Db;
use auradesk_core::infrastructure::event_bus::{EventBus, EventDispatchResult};
use auradesk_core::infrastructure::secret_store::SecretStore;

#[test]
fn test_plugin_lifecycle_permissions_secrets_dedup_and_audit() {
    let db = Db::open_in_memory().expect("open test db");
    let secret_store = SecretStore::new("com.ragton.auradesk.test");
    let event_bus = EventBus::default();

    let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/plugins/demo-ops");

    let manager = PluginManager::new(&db, &secret_store, &event_bus, fixture_dir.parent().unwrap());

    // 1. Discover local plugins
    let discovered = manager.discover_local_plugins().expect("discover plugins");
    assert!(discovered.iter().any(|p| p.id == "demo-ops"));

    // 2. Install plugin
    let plugin = manager.install_plugin(&fixture_dir).expect("install plugin");
    assert_eq!(plugin.id, "demo-ops");
    assert_eq!(plugin.contract_version, "1.0");
    assert!(!plugin.enabled); // disabled by default (Privacy by default)

    // Check permissions are ungranted initially
    let perms = &plugin.permissions;
    assert_eq!(perms.len(), 2);
    assert!(!perms.iter().any(|p| p.granted));

    // 3. Disabled plugin cannot execute action
    let err = manager.execute_action(ExecutePluginActionInput {
        plugin_id: "demo-ops".into(),
        action: "fetch_tickets".into(),
        params: serde_json::json!({}),
        confirmed_by_user: false,
    });
    assert!(err.is_err());

    // 4. Enable plugin and store secret in SecretStore
    manager.set_enabled("demo-ops", true).expect("enable plugin");
    manager.set_plugin_secret("demo-ops", "credentials", "super-secret-token-123")
        .expect("set secret");
    assert!(manager.has_plugin_secret("demo-ops", "credentials").expect("has secret"));

    // 5. Action without granted permission fails
    let err_perm = manager.execute_action(ExecutePluginActionInput {
        plugin_id: "demo-ops".into(),
        action: "fetch_tickets".into(),
        params: serde_json::json!({}),
        confirmed_by_user: false,
    });
    assert!(err_perm.is_err());

    // Grant read_tickets
    manager.set_permission("demo-ops", "read_tickets", true).expect("grant permission");
    let ok_read = manager.execute_action(ExecutePluginActionInput {
        plugin_id: "demo-ops".into(),
        action: "fetch_tickets".into(),
        params: serde_json::json!({}),
        confirmed_by_user: false,
    });
    assert!(ok_read.is_ok());

    // 6. Action requiring human confirmation fails if not confirmed
    manager.set_permission("demo-ops", "write_ticket_comment", true).expect("grant write");
    let err_unconfirmed = manager.execute_action(ExecutePluginActionInput {
        plugin_id: "demo-ops".into(),
        action: "add_comment".into(),
        params: serde_json::json!({"text": "Hello"}),
        confirmed_by_user: false, // NOT confirmed
    });
    assert!(err_unconfirmed.is_err());

    let ok_confirmed = manager.execute_action(ExecutePluginActionInput {
        plugin_id: "demo-ops".into(),
        action: "add_comment".into(),
        params: serde_json::json!({"text": "Hello"}),
        confirmed_by_user: true, // Confirmed
    });
    assert!(ok_confirmed.is_ok());

    // 7. Event Bus Deduplication
    let ev1 = NormalizedPluginEvent {
        event_id: "e1".into(),
        plugin_id: "demo-ops".into(),
        event_type: "ticket.assigned".into(),
        resource_id: "TICK-101".into(),
        title: "Test Ticket".into(),
        summary: "Something broke".into(),
        severity: "medium".into(),
        timestamp: "2026-11-27T17:00:00Z".into(),
        raw_data: serde_json::json!({}),
    };

    let dispatch1 = manager.ingest_event(ev1.clone()).expect("ingest 1");
    assert!(matches!(dispatch1, EventDispatchResult::Accepted(_)));

    // Duplicate event within dedup window
    let dispatch2 = manager.ingest_event(ev1).expect("ingest duplicate");
    assert!(matches!(dispatch2, EventDispatchResult::Deduplicated { .. }));

    // 8. Audit log records actions and checks
    let audits = manager.list_audit_log(Some("demo-ops"), 20).expect("list audit log");
    assert!(!audits.is_empty());
    assert!(audits.iter().any(|a| a.action == "install"));
    assert!(audits.iter().any(|a| a.action == "add_comment" && a.user_confirmed));

    // 9. Disabling revokes credentials
    manager.set_enabled("demo-ops", false).expect("disable plugin");
    assert!(!manager.has_plugin_secret("demo-ops", "credentials").expect("secret revoked"));

    // 10. Uninstall removes records and revokes any remaining secrets
    manager.uninstall_plugin("demo-ops").expect("uninstall plugin");
    assert!(manager.get_plugin("demo-ops").is_err());
}
