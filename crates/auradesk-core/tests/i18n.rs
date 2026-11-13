//! Tests for the core i18n backend (rust-i18n).
//!
//! The backend resolves keys from `crates/auradesk-core/locales/*.yml`.
//! These tests pin the contract other crates rely on: a key resolves in
//! the requested language, and an unknown key falls back to itself.
//!
//! `set_locale` mutates process-wide state, so the assertions below use
//! an explicit locale instead. Tests run in parallel, and a shared global
//! locale would let one test see another's language.

use auradesk_core::i18n::translate_in;

/// Translate a key in a specific locale, without touching global state.
fn t_in(locale: &str, key: &str) -> String {
    translate_in(locale, key)
}

#[test]
fn resolves_key_in_the_requested_locale() {
    assert_eq!(
        t_in("pt-BR", "alerts.focus_interrupted"),
        "Foco interrompido"
    );
    assert_eq!(t_in("en", "alerts.focus_interrupted"), "Focus interrupted");
}

#[test]
fn resolves_nested_keys() {
    assert_eq!(
        t_in("pt-BR", "alerts.focus_completed_body"),
        "Hora de alongar. Clique em ✓ para iniciar a pausa."
    );
    assert_eq!(t_in("pt-BR", "tray.show"), "Mostrar AuraDesk");
    assert_eq!(t_in("en", "tray.show"), "Show AuraDesk");
}

#[test]
fn unknown_key_falls_back_to_the_key_itself() {
    assert_eq!(t_in("en", "no.such.key"), "en.no.such.key");
    assert_eq!(t_in("pt-BR", "no.such.key"), "pt-BR.no.such.key");
}

#[test]
fn both_locales_carry_the_same_keys() {
    // A key present in one locale but missing in the other would surface
    // as a raw key at runtime, so the two files must stay in sync.
    let keys = [
        "hello",
        "alerts.focus_interrupted",
        "alerts.focus_completed",
        "alerts.focus_interrupted_body",
        "alerts.focus_completed_body",
        "tray.show",
        "tray.quit",
        "github.issue_label",
    ];
    for key in keys {
        let pt = t_in("pt-BR", key);
        let en = t_in("en", key);
        assert!(!pt.ends_with(key), "missing pt-BR translation for {key}");
        assert!(!en.ends_with(key), "missing en translation for {key}");
    }
}
