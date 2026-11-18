//! Automatic GitHub Releases updater with SHA-256 verification and silent self-install.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::updater::{
    is_newer_version, is_trusted_release_download_url, parse_sha256_sums, select_platform_asset,
    verify_sha256_bytes, ReleaseAsset, GITHUB_OWNER, GITHUB_REPO,
};
use auradesk_core::infrastructure::db::Db;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::logging;

/// Background polling interval between silent update checks (6 hours).
const AUTO_CHECK_INTERVAL_SECS: u64 = 6 * 60 * 60;
const INITIAL_STARTUP_DELAY_SECS: u64 = 12;

/// Snapshot of updater progress and availability sent to the frontend over IPC & events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStateSnapshot {
    pub status: String,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub release_url: Option<String>,
    pub asset_name: Option<String>,
    pub progress_pct: u8,
    pub auto_update_enabled: bool,
    pub last_checked_at: Option<String>,
    pub downloaded_path: Option<String>,
    pub error_message: Option<String>,
}

impl UpdateStateSnapshot {
    pub fn initial(auto_update_enabled: bool) -> Self {
        Self {
            status: "idle".to_string(),
            current_version: env!("CARGO_PKG_VERSION").to_string(),
            latest_version: None,
            release_notes: None,
            release_url: None,
            asset_name: None,
            progress_pct: 0,
            auto_update_enabled,
            last_checked_at: None,
            downloaded_path: None,
            error_message: None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GithubReleaseResponse {
    tag_name: String,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAssetResponse>,
}

#[derive(Debug, Deserialize)]
struct GithubAssetResponse {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
}

/// Shared runtime coordinator for update checks, downloads, verification, and restart.
pub struct UpdaterManager {
    state: Mutex<UpdateStateSnapshot>,
    busy: AtomicBool,
    pending_asset: Mutex<Option<PendingReleaseDownload>>,
}

#[derive(Debug, Clone)]
struct PendingReleaseDownload {
    version: String,
    asset: ReleaseAsset,
    checksums_url: Option<String>,
}

impl UpdaterManager {
    pub fn new(auto_update_enabled: bool) -> Self {
        Self {
            state: Mutex::new(UpdateStateSnapshot::initial(auto_update_enabled)),
            busy: AtomicBool::new(false),
            pending_asset: Mutex::new(None),
        }
    }

    pub fn snapshot(&self, db: &Db) -> UpdateStateSnapshot {
        let auto_update_enabled = read_auto_update_setting(db);
        let Ok(mut guard) = self.state.lock() else {
            return UpdateStateSnapshot::initial(auto_update_enabled);
        };
        guard.auto_update_enabled = auto_update_enabled;
        guard.clone()
    }

    fn set_and_emit(&self, app: &AppHandle, mut next: UpdateStateSnapshot) {
        if let Ok(mut guard) = self.state.lock() {
            next.current_version = guard.current_version.clone();
            *guard = next.clone();
        }
        let _ = app.emit("auradesk://update-status", next);
    }

    fn update_progress(&self, app: &AppHandle, pct: u8) {
        let snap = {
            let Ok(mut guard) = self.state.lock() else {
                return;
            };
            if guard.progress_pct == pct {
                return;
            }
            guard.progress_pct = pct;
            guard.clone()
        };
        let _ = app.emit("auradesk://update-status", snap);
    }
}

pub fn read_auto_update_setting(db: &Db) -> bool {
    SettingsService::new(db)
        .get(SettingsKey::UpdatesAutoUpdate)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// Spawn the background loop that checks GitHub Releases periodically and auto-updates
/// when `updates.auto_update` is enabled.
pub fn spawn_auto_update_loop(
    app: AppHandle,
    db: Arc<Db>,
    data_dir: PathBuf,
    manager: Arc<UpdaterManager>,
) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(INITIAL_STARTUP_DELAY_SECS));
        loop {
            if read_auto_update_setting(&db) {
                let _ = check_and_maybe_install(&app, &db, &data_dir, &manager, true);
            }
            std::thread::sleep(Duration::from_secs(AUTO_CHECK_INTERVAL_SECS));
        }
    });
}

/// Check GitHub Releases (`releases/latest`) and, when `auto_install` is true, automatically
/// download, SHA-256 verify, and apply any newer release.
pub fn check_and_maybe_install(
    app: &AppHandle,
    db: &Db,
    data_dir: &Path,
    manager: &UpdaterManager,
    auto_install: bool,
) -> Result<UpdateStateSnapshot, String> {
    if manager.busy.swap(true, Ordering::SeqCst) {
        return Ok(manager.snapshot(db));
    }

    let result = (|| -> Result<UpdateStateSnapshot, String> {
        let auto_enabled = read_auto_update_setting(db);
        let now_str = Utc::now().to_rfc3339();

        let mut snap = manager.snapshot(db);
        snap.status = "checking".to_string();
        snap.error_message = None;
        snap.auto_update_enabled = auto_enabled;
        snap.progress_pct = 0;
        manager.set_and_emit(app, snap.clone());

        let release_opt = fetch_latest_release()?;
        let Some(release) = release_opt else {
            snap.status = "up_to_date".to_string();
            snap.last_checked_at = Some(now_str);
            manager.set_and_emit(app, snap.clone());
            return Ok(snap);
        };

        if release.draft || release.prerelease {
            snap.status = "up_to_date".to_string();
            snap.last_checked_at = Some(now_str);
            manager.set_and_emit(app, snap.clone());
            return Ok(snap);
        }

        if !is_newer_version(&snap.current_version, &release.tag_name) {
            snap.status = "up_to_date".to_string();
            snap.latest_version = Some(
                release
                    .tag_name
                    .trim()
                    .trim_start_matches(['v', 'V'])
                    .to_string(),
            );
            snap.last_checked_at = Some(now_str);
            manager.set_and_emit(app, snap.clone());
            return Ok(snap);
        }

        let clean_ver = release
            .tag_name
            .trim()
            .trim_start_matches(['v', 'V'])
            .to_string();
        let assets: Vec<ReleaseAsset> = release
            .assets
            .into_iter()
            .map(|a| ReleaseAsset {
                name: a.name,
                download_url: a.browser_download_url,
                size: a.size,
            })
            .collect();

        let checksums_url = assets
            .iter()
            .find(|a| {
                a.name.eq_ignore_ascii_case("SHA256SUMS.txt")
                    && is_trusted_release_download_url(&a.download_url)
            })
            .map(|a| a.download_url.clone());

        let selected = select_platform_asset(&assets, std::env::consts::OS, std::env::consts::ARCH)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "no compatible installer asset found for {}/{}",
                    std::env::consts::OS,
                    std::env::consts::ARCH
                )
            })?;

        if let Ok(mut pending) = manager.pending_asset.lock() {
            *pending = Some(PendingReleaseDownload {
                version: clean_ver.clone(),
                asset: selected.clone(),
                checksums_url: checksums_url.clone(),
            });
        }

        snap.status = "available".to_string();
        snap.latest_version = Some(clean_ver.clone());
        snap.release_notes = release.body;
        snap.release_url = Some(release.html_url);
        snap.asset_name = Some(selected.name.clone());
        snap.last_checked_at = Some(now_str);
        manager.set_and_emit(app, snap.clone());

        logging::log_info(format!(
            "update available: {} -> {} (asset={})",
            snap.current_version, clean_ver, selected.name
        ));

        if auto_install {
            return download_verify_and_install_internal(app, db, data_dir, manager);
        }

        Ok(snap)
    })();

    manager.busy.store(false, Ordering::SeqCst);

    match result {
        Ok(snap) => Ok(snap),
        Err(err) => {
            logging::log_warn(format!("updater check failed: {err}"));
            let mut err_snap = manager.snapshot(db);
            err_snap.status = "error".to_string();
            err_snap.last_checked_at = Some(Utc::now().to_rfc3339());
            err_snap.error_message = Some(err.clone());
            manager.set_and_emit(app, err_snap);
            Err(err)
        }
    }
}

/// Download, SHA-256 verify, and apply a pending release (fetching latest first if needed).
pub fn install_update_now(
    app: &AppHandle,
    db: &Db,
    data_dir: &Path,
    manager: &UpdaterManager,
) -> Result<UpdateStateSnapshot, String> {
    if manager.busy.swap(true, Ordering::SeqCst) {
        return Ok(manager.snapshot(db));
    }

    let has_pending = manager
        .pending_asset
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);

    let res = if has_pending {
        download_verify_and_install_internal(app, db, data_dir, manager)
    } else {
        manager.busy.store(false, Ordering::SeqCst);
        return check_and_maybe_install(app, db, data_dir, manager, true);
    };

    manager.busy.store(false, Ordering::SeqCst);

    match res {
        Ok(snap) => Ok(snap),
        Err(err) => {
            logging::log_error(format!("updater install failed: {err}"));
            let mut err_snap = manager.snapshot(db);
            err_snap.status = "error".to_string();
            err_snap.error_message = Some(err.clone());
            manager.set_and_emit(app, err_snap);
            Err(err)
        }
    }
}

fn download_verify_and_install_internal(
    app: &AppHandle,
    db: &Db,
    data_dir: &Path,
    manager: &UpdaterManager,
) -> Result<UpdateStateSnapshot, String> {
    let pending = manager
        .pending_asset
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .ok_or_else(|| "no pending release selected for install".to_string())?;

    let checksum_url = pending
        .checksums_url
        .as_deref()
        .ok_or_else(|| "release is missing SHA256SUMS.txt verification manifest".to_string())?;

    let mut snap = manager.snapshot(db);
    snap.status = "downloading".to_string();
    snap.progress_pct = 0;
    snap.error_message = None;
    manager.set_and_emit(app, snap.clone());

    let client = build_http_client(Duration::from_secs(180))?;
    let sums_text = client
        .get(checksum_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download SHA256SUMS.txt: {e}"))?
        .text()
        .map_err(|e| format!("read SHA256SUMS.txt: {e}"))?;

    let sums = parse_sha256_sums(&sums_text);
    let expected_hash = sums
        .get(&pending.asset.name.to_ascii_lowercase())
        .cloned()
        .ok_or_else(|| {
            format!(
                "missing checksum entry for '{}' in SHA256SUMS.txt",
                pending.asset.name
            )
        })?;

    let updates_dir = data_dir.join("updates");
    fs::create_dir_all(&updates_dir).map_err(|e| format!("create updates dir: {e}"))?;
    let file_name = Path::new(&pending.asset.name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid release asset filename".to_string())?;
    let dest_path = updates_dir.join(file_name);

    let mut resp = client
        .get(&pending.asset.download_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download release asset: {e}"))?;

    let total_bytes = resp.content_length().unwrap_or(pending.asset.size);
    let mut out_file =
        File::create(&dest_path).map_err(|e| format!("create update installer file: {e}"))?;
    let mut buf = [0u8; 64 * 1024];
    let mut downloaded: u64 = 0;

    loop {
        let n = resp
            .read(&mut buf)
            .map_err(|e| format!("read update stream: {e}"))?;
        if n == 0 {
            break;
        }
        out_file
            .write_all(&buf[..n])
            .map_err(|e| format!("write update installer: {e}"))?;
        downloaded += n as u64;
        if let Some(pct_raw) = downloaded.saturating_mul(100).checked_div(total_bytes) {
            manager.update_progress(app, pct_raw.min(100) as u8);
        }
    }
    out_file
        .flush()
        .map_err(|e| format!("flush update installer: {e}"))?;
    drop(out_file);

    snap.status = "verifying".to_string();
    snap.progress_pct = 100;
    snap.downloaded_path = Some(dest_path.display().to_string());
    manager.set_and_emit(app, snap.clone());

    let bytes = fs::read(&dest_path).map_err(|e| format!("read downloaded installer: {e}"))?;
    if let Err(e) = verify_sha256_bytes(&bytes, &expected_hash) {
        let _ = fs::remove_file(&dest_path);
        return Err(e);
    }

    snap.status = "installing".to_string();
    manager.set_and_emit(app, snap.clone());

    logging::log_info(format!(
        "verified update {} at {}; launching installer and restarting",
        pending.version,
        dest_path.display()
    ));

    spawn_installer_and_exit(app, &updates_dir, &dest_path)?;
    Ok(snap)
}

fn build_http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(format!("AuraDesk/{}", env!("CARGO_PKG_VERSION")))
        .timeout(timeout)
        .build()
        .map_err(|e| format!("build http client: {e}"))
}

fn fetch_latest_release() -> Result<Option<GithubReleaseResponse>, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest");
    let client = build_http_client(Duration::from_secs(20))?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|e| format!("request github releases: {e}"))?;

    if resp.status().as_u16() == 404 {
        logging::log_info("no published github release found yet (404)");
        return Ok(None);
    }
    let resp = resp
        .error_for_status()
        .map_err(|e| format!("github releases api error: {e}"))?;

    resp.json::<GithubReleaseResponse>()
        .map(Some)
        .map_err(|e| format!("parse github release json: {e}"))
}

fn spawn_installer_and_exit(
    app: &AppHandle,
    updates_dir: &Path,
    installer_path: &Path,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;

        let pid = std::process::id();
        let current_exe =
            std::env::current_exe().map_err(|e| format!("resolve current_exe: {e}"))?;
        let script_path = updates_dir.join("apply-update.ps1");
        let script_body = r#"param(
  [int]$ParentPid,
  [string]$InstallerPath,
  [string]$RelaunchExe
)
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 300
if ($InstallerPath.ToLower().EndsWith('.msi')) {
  $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $InstallerPath, '/passive', '/norestart') -Wait -PassThru
} else {
  $proc = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -Wait -PassThru
}
if ($proc.ExitCode -eq 0 -and (Test-Path $RelaunchExe)) {
  Start-Process -FilePath $RelaunchExe
}
Remove-Item -Path $InstallerPath -Force -ErrorAction SilentlyContinue
"#;
        fs::write(&script_path, script_body)
            .map_err(|e| format!("write windows updater helper: {e}"))?;

        std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &script_path.display().to_string(),
                "-ParentPid",
                &pid.to_string(),
                "-InstallerPath",
                &installer_path.display().to_string(),
                "-RelaunchExe",
                &current_exe.display().to_string(),
            ])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()
            .map_err(|e| format!("spawn windows updater helper: {e}"))?;

        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            handle.exit(0);
        });
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let _ = updates_dir;
        if let Some(appimage) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) {
            use std::os::unix::fs::PermissionsExt;
            let target = PathBuf::from(appimage);
            let backup = target.with_extension("AppImage.bak");
            let _ = fs::rename(&target, &backup);
            if let Err(e) = fs::copy(installer_path, &target) {
                let _ = fs::rename(&backup, &target);
                return Err(format!("replace AppImage: {e}"));
            }
            if let Ok(meta) = fs::metadata(&target) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&target, perms);
            }
            let _ = fs::remove_file(&backup);
            let _ = std::process::Command::new(&target).spawn();
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || {
                handle.exit(0);
            });
            return Ok(());
        }
        std::process::Command::new("xdg-open")
            .arg(installer_path)
            .spawn()
            .map_err(|e| format!("open linux installer: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let _ = (app, updates_dir);
        std::process::Command::new("open")
            .arg(installer_path)
            .spawn()
            .map_err(|e| format!("open macOS dmg: {e}"))?;
        Ok(())
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (app, updates_dir, installer_path);
        Err("unsupported OS for self-update".to_string())
    }
}
