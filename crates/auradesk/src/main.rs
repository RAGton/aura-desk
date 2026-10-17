//! Tauri entry point. Phase 0 T5: opens a window titled "AuraDesk" with
//! a system tray, and applies close-to-tray behavior (closing the
//! window hides it; the process keeps running until explicit Quit).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    auradesk::runtime::build()
        .run(tauri::generate_context!())
        .expect("error while running AuraDesk");
}
