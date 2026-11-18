//! i18n backend (rust-i18n). Initialized at app startup. Locales live in
//! `locales/{en,pt-BR}.yml`. Phase 0 ships minimal stubs.

// Module-level exception for `missing_docs`. The `i18n!("locales")`
// macro from `rust-i18n-macro 0.3.0` generates a `pub fn translate(...)`
// without any documentation, and the proc-macro does not propagate
// outer attributes from the call site to the generated items. Since
// `rust-i18n` is pinned at 0.4 (we cannot bump), the only way to keep
// `#![warn(missing_docs)]` active at the crate level is to silence it
// locally for this module. `set_locale` is documented explicitly.
#![allow(missing_docs)]

use rust_i18n::i18n;

i18n!("locales");

/// Set the active locale for subsequent `t!` lookups in this process.
pub fn set_locale(locale: &str) {
    rust_i18n::set_locale(locale);
}

/// Translate a key using the active locale.
///
/// The `t!` macro expands to `crate::translate`, so it only resolves inside
/// the crate that called `i18n!`. This function is the cross-crate entry
/// point: other crates in the workspace call `auradesk_core::i18n::t`.
pub fn t(key: &str) -> String {
    translate(rust_i18n::locale().as_str(), key)
}

/// Translate a key using the active locale and interpolate `%{name}` placeholders.
pub fn t_with(key: &str, vars: &[(&str, &str)]) -> String {
    let mut out = t(key);
    for (name, val) in vars {
        out = out.replace(&format!("%{{{name}}}"), val);
    }
    out
}

/// Translate a key in a specific locale, ignoring the active one.
///
/// Useful when a caller needs a fixed language regardless of the global
/// locale, and when tests need to assert translations without mutating
/// process-wide state.
pub fn translate_in(locale: &str, key: &str) -> String {
    translate(locale, key)
}
