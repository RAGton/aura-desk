//! Tauri entry point. Supports `auradesk list-capabilities` CLI subcommand
//! as well as launching the desktop window with system tray and close-to-tray.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "list-capabilities") {
        let caps = auradesk::list_capabilities();
        let json = serde_json::to_string_pretty(caps).expect("serialize capabilities");
        println!("{json}");
        return;
    }

    auradesk::runtime::build()
        .run(tauri::generate_context!())
        .expect("error while running AuraDesk");
}
