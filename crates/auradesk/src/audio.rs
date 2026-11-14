//! Native desktop audio adapter implementing [`AudioPort`].
//!
//! Plays lightweight OS notification cues in a detached thread without adding
//! native ALSA/audio-driver build dependencies so Linux/macOS/Windows CI builds
//! stay self-contained.

use auradesk_core::domain::reminder::ReminderSound;
use auradesk_core::infrastructure::audio::AudioPort;
use auradesk_core::CoreError;

/// Native desktop audio cue player.
#[derive(Debug, Default, Clone, Copy)]
pub struct DesktopAudio;

impl DesktopAudio {
    /// Construct a desktop audio adapter.
    pub fn new() -> Self {
        Self
    }
}

impl AudioPort for DesktopAudio {
    fn play(&self, sound: ReminderSound) -> Result<(), CoreError> {
        if matches!(sound, ReminderSound::None) {
            return Ok(());
        }

        let urgent = matches!(sound, ReminderSound::Urgent);
        std::thread::spawn(move || play_os_cue(urgent));
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn play_os_cue(urgent: bool) {
    #[link(name = "user32")]
    extern "system" {
        fn MessageBeep(u_type: u32) -> i32;
    }
    // MB_ICONEXCLAMATION (0x30) for urgent, MB_ICONASTERISK (0x40) otherwise.
    let kind = if urgent { 0x0000_0030 } else { 0x0000_0040 };
    // SAFETY: Standard Win32 user32 API taking a plain integer sound flag.
    unsafe {
        let _ = MessageBeep(kind);
    }
}

#[cfg(target_os = "macos")]
fn play_os_cue(urgent: bool) {
    let path = if urgent {
        "/System/Library/Sounds/Sosumi.aiff"
    } else {
        "/System/Library/Sounds/Glass.aiff"
    };
    let _ = std::process::Command::new("afplay").arg(path).status();
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn play_os_cue(urgent: bool) {
    let sound = if urgent {
        "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"
    } else {
        "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"
    };
    if std::path::Path::new(sound).exists() {
        if std::process::Command::new("paplay")
            .arg(sound)
            .status()
            .is_ok()
        {
            return;
        }
        let _ = std::process::Command::new("pw-play").arg(sound).status();
    }
}
