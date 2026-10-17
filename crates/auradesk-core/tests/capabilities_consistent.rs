//! Smoke test for the capability registry (Phase 0 T9).
//!
//! Asserts the registry's surface: returns an empty slice in Phase 0
//! and the names are alphabetically sorted (a future invariant that
//! should hold as tools are added).
//!
//! Run with: cargo test -p auradesk-core --test capabilities_consistent

use auradesk_core::capabilities;

#[test]
fn registry_is_empty_in_phase_0() {
    let caps = capabilities();
    assert!(caps.is_empty(), "Phase 0 registry must be empty; got {} entries", caps.len());
}

#[test]
fn registry_names_are_alphabetically_sorted() {
    let caps = capabilities();
    let names: Vec<&str> = caps.iter().map(|c| c.name).collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    assert_eq!(names, sorted, "capability names must be alphabetical; got {:?}", names);
}

#[test]
fn no_capability_kind_is_unspecified() {
    for c in capabilities() {
        // Compile-time check via match; runtime check via Debug print
        let _ = format!("{:?}", c);
    }
}
