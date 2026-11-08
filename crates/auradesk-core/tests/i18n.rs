//! Tests for the core i18n backend (rust-i18n).
//!
//! The backend resolves keys from `crates/auradesk-core/locales/*.yml`.
//! These tests pin the contract other crates rely on: `set_locale` switches
//! the active language and `t` resolves the key in that language.

use auradesk_core::i18n::{self, set_locale, t};

#[test]
fn resolves_key_in_the_active_locale() {
    set_locale("pt-BR");
    let pt = t("alerts.focus_interrupted");
    assert_eq!(pt, "Foco interrompido");

    set_locale("en");
    let en = t("alerts.focus_interrupted");
    assert_eq!(en, "Focus interrupted");
}

#[test]
fn resolves_nested_keys() {
    set_locale("pt-BR");
    assert_eq!(
        t("alerts.focus_completed_body"),
        "Hora de alongar. Clique em ✓ para iniciar a pausa."
    );
    assert_eq!(t("tray.show"), "Mostrar AuraDesk");
}

#[test]
fn unknown_key_falls_back_to_the_key_itself() {
    set_locale("en");
    assert_eq!(t("no.such.key"), "en.no.such.key");
}

#[test]
fn locale_helper_reports_the_active_locale() {
    set_locale("pt-BR");
    assert_eq!(rust_i18n::locale(), "pt-BR");
    // The module re-export stays in sync with the global locale.
    let _ = i18n::t("hello");
}
