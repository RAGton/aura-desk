//! Pure desktop integration domain types & algorithms (Phase 3).
//!
//! Keeps multi-monitor fallback resolution, compact-window geometry, and
//! Linux `.desktop` autostart generation framework-agnostic and testable
//! without live Tauri/X11/Win32 windows.

use serde::{Deserialize, Serialize};

/// Metadata describing an attached OS display monitor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    /// Display name reported by the OS/Tauri (or synthetic ID when unnamed).
    pub name: String,
    /// Physical pixel width.
    pub width: u32,
    /// Physical pixel height.
    pub height: u32,
    /// Physical top-left X coordinate in virtual desktop space.
    pub x: i32,
    /// Physical top-left Y coordinate in virtual desktop space.
    pub y: i32,
    /// DPI scale factor (`>= 1.0`).
    pub scale_factor: f64,
    /// Whether this monitor is the OS primary display.
    pub is_primary: bool,
}

impl MonitorInfo {
    /// Logical width in DIPs (`width / scale_factor`).
    pub fn logical_width(&self) -> f64 {
        self.width as f64 / self.scale_factor.max(1.0)
    }

    /// Logical height in DIPs (`height / scale_factor`).
    pub fn logical_height(&self) -> f64 {
        self.height as f64 / self.scale_factor.max(1.0)
    }

    /// Logical top-left X in DIPs.
    pub fn logical_x(&self) -> f64 {
        self.x as f64 / self.scale_factor.max(1.0)
    }

    /// Logical top-left Y in DIPs.
    pub fn logical_y(&self) -> f64 {
        self.y as f64 / self.scale_factor.max(1.0)
    }
}

/// Strategy applied when `monitor.preferred` is disconnected or missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MonitorFallbackStrategy {
    /// Move to the primary monitor if available; hide the window if none exists.
    #[default]
    PrimaryThenHide,
    /// Always move to the primary monitor (or first monitor if none flagged primary).
    Primary,
    /// Hide the window into the system tray instead of moving it to primary.
    Hide,
}

impl MonitorFallbackStrategy {
    /// Parse from the settings string; unknown strings default to `PrimaryThenHide`.
    pub fn parse(raw: Option<&str>) -> Self {
        match raw.map(str::trim) {
            Some("primary") => Self::Primary,
            Some("hide") => Self::Hide,
            _ => Self::PrimaryThenHide,
        }
    }

    /// Canonical string representation matching `settings.monitor.fallback_strategy`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PrimaryThenHide => "primary_then_hide",
            Self::Primary => "primary",
            Self::Hide => "hide",
        }
    }
}

/// Outcome of resolving where a desktop window should live.
#[derive(Debug, Clone, PartialEq)]
pub enum MonitorResolution {
    /// Place the window on the resolved monitor.
    PlaceOn(MonitorInfo),
    /// No suitable target monitor exists under the fallback policy; keep hidden.
    HideWindow,
}

/// Port for querying attached monitors (implemented by Tauri shell & mocks in tests).
pub trait MonitorProvider: Send + Sync {
    /// List currently connected monitors.
    fn available_monitors(&self) -> Vec<MonitorInfo>;
}

/// Resolve the target monitor given the connected list, preference, and fallback strategy.
pub fn resolve_target_monitor(
    monitors: &[MonitorInfo],
    preferred: Option<&str>,
    strategy: MonitorFallbackStrategy,
) -> MonitorResolution {
    if monitors.is_empty() {
        return MonitorResolution::HideWindow;
    }

    let primary = monitors
        .iter()
        .find(|m| m.is_primary)
        .or_else(|| monitors.first());

    let pref = preferred.map(str::trim).unwrap_or("primary");

    if pref.is_empty() || pref.eq_ignore_ascii_case("primary") {
        return match primary {
            Some(m) => MonitorResolution::PlaceOn(m.clone()),
            None => MonitorResolution::HideWindow,
        };
    }

    if pref.eq_ignore_ascii_case("secondary") {
        if let Some(sec) = monitors.iter().find(|m| !m.is_primary) {
            return MonitorResolution::PlaceOn(sec.clone());
        }
    } else if let Some(exact) = monitors
        .iter()
        .find(|m| m.name == pref || m.name.eq_ignore_ascii_case(pref))
    {
        return MonitorResolution::PlaceOn(exact.clone());
    }

    // Preferred monitor is missing / disconnected: apply fallback strategy.
    match strategy {
        MonitorFallbackStrategy::Hide => MonitorResolution::HideWindow,
        MonitorFallbackStrategy::Primary | MonitorFallbackStrategy::PrimaryThenHide => {
            match primary {
                Some(m) => MonitorResolution::PlaceOn(m.clone()),
                None => MonitorResolution::HideWindow,
            }
        }
    }
}

/// Compute top-right logical `(x, y)` coordinates for the floating Compact Mode widget.
pub fn compute_compact_window_origin(
    monitor: &MonitorInfo,
    window_width: f64,
    margin: f64,
) -> (f64, f64) {
    let min_x = monitor.logical_x() + margin;
    let x = (monitor.logical_x() + monitor.logical_width() - window_width - margin).max(min_x);
    let y = monitor.logical_y() + margin;
    (x, y)
}

/// Render an XDG autostart `.desktop` entry for Linux (`~/.config/autostart/auradesk.desktop`).
pub fn format_linux_autostart_desktop_entry(exec_path: &str) -> String {
    let trimmed = exec_path.trim();
    let escaped = if trimmed.contains(' ') && !trimmed.starts_with('"') {
        format!("\"{trimmed}\"")
    } else {
        trimmed.to_string()
    };
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=AuraDesk\n\
         Exec={escaped} --tray\n\
         Icon=auradesk\n\
         Terminal=false\n\
         Categories=Office;Utility;\n\
         StartupNotify=false\n\
         X-GNOME-Autostart-enabled=true\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockMonitorProvider {
        monitors: Vec<MonitorInfo>,
    }

    impl MonitorProvider for MockMonitorProvider {
        fn available_monitors(&self) -> Vec<MonitorInfo> {
            self.monitors.clone()
        }
    }

    fn mon(name: &str, x: i32, primary: bool) -> MonitorInfo {
        MonitorInfo {
            name: name.to_string(),
            width: 1920,
            height: 1080,
            x,
            y: 0,
            scale_factor: 1.0,
            is_primary: primary,
        }
    }

    #[test]
    fn resolves_preferred_secondary_and_named_monitor() {
        let provider = MockMonitorProvider {
            monitors: vec![mon("DP-1", 0, true), mon("HDMI-1", 1920, false)],
        };
        let list = provider.available_monitors();

        assert_eq!(
            resolve_target_monitor(&list, Some("secondary"), MonitorFallbackStrategy::Hide),
            MonitorResolution::PlaceOn(mon("HDMI-1", 1920, false))
        );
        assert_eq!(
            resolve_target_monitor(&list, Some("hdmi-1"), MonitorFallbackStrategy::Hide),
            MonitorResolution::PlaceOn(mon("HDMI-1", 1920, false))
        );
    }

    #[test]
    fn applies_fallback_strategies_when_preferred_monitor_disconnects() {
        let single = vec![mon("DP-1", 0, true)];

        // Disconnected HDMI-1 with PrimaryThenHide -> moves to primary DP-1
        assert_eq!(
            resolve_target_monitor(
                &single,
                Some("HDMI-1"),
                MonitorFallbackStrategy::PrimaryThenHide
            ),
            MonitorResolution::PlaceOn(mon("DP-1", 0, true))
        );

        // Disconnected HDMI-1 with Hide -> hides to tray
        assert_eq!(
            resolve_target_monitor(&single, Some("HDMI-1"), MonitorFallbackStrategy::Hide),
            MonitorResolution::HideWindow
        );

        // Zero monitors attached -> always hides
        assert_eq!(
            resolve_target_monitor(&[], Some("primary"), MonitorFallbackStrategy::Primary),
            MonitorResolution::HideWindow
        );
    }

    #[test]
    fn computes_compact_origin_and_linux_autostart_entry() {
        let hi_dpi = MonitorInfo {
            name: "eDP-1".into(),
            width: 3840,
            height: 2160,
            x: 0,
            y: 0,
            scale_factor: 2.0,
            is_primary: true,
        };
        assert_eq!(
            compute_compact_window_origin(&hi_dpi, 300.0, 16.0),
            (1604.0, 16.0)
        );

        let desktop = format_linux_autostart_desktop_entry("/usr/local/bin/auradesk");
        assert!(desktop.contains("Exec=/usr/local/bin/auradesk --tray"));
        assert!(desktop.contains("X-GNOME-Autostart-enabled=true"));
    }
}
