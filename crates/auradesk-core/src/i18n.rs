//! i18n backend (rust-i18n). Initialized at app startup. Locales live in
//! `locales/{en,pt-BR}.yml`. Phase 0 ships minimal stubs.

use rust_i18n::i18n;

i18n!("locales", fallback = "en");

pub fn set_locale(locale: &str) {
    rust_i18n::set_locale(locale);
}
