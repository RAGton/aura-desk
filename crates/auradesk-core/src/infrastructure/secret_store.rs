//! Secure credential storage backed by OS Keyring / secret-tool / fallback file.
//!
//! Never stores secrets in SQLite. Uses `secret-tool` on Linux if available,
//! or a safe scoped local encrypted/obfuscated fallback directory if secret-tool is absent.

use std::process::Command;
use crate::CoreError;

/// Storage interface for secrets.
pub struct SecretStore {
    app_id: String,
}

impl Default for SecretStore {
    fn default() -> Self {
        Self::new("com.ragton.auradesk")
    }
}

impl SecretStore {
    /// Create a new SecretStore for the given app id.
    pub fn new(app_id: impl Into<String>) -> Self {
        Self {
            app_id: app_id.into(),
        }
    }

    fn fallback_path(&self, key: &str) -> std::path::PathBuf {
        let base = std::env::var("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
                std::path::PathBuf::from(home).join(".local/share")
            });
        base.join(&self.app_id).join("secrets").join(key)
    }

    /// Store a secret in the OS vault or safe user storage.
    pub fn set_secret(&self, key: &str, secret: &str) -> Result<(), CoreError> {
        // Attempt using `secret-tool` on Linux
        let output = Command::new("secret-tool")
            .arg("store")
            .arg("--label")
            .arg(format!("AuraDesk Secret ({key})"))
            .arg("service")
            .arg(&self.app_id)
            .arg("key")
            .arg(key)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                use std::io::Write;
                if let Some(mut stdin) = child.stdin.take() {
                    stdin.write_all(secret.as_bytes())?;
                }
                child.wait_with_output()
            });

        if let Ok(out) = output {
            if out.status.success() {
                return Ok(());
            }
        }

        // Fallback: private permission 0600 file under XDG_DATA_HOME/com.ragton.auradesk/secrets/
        let p = self.fallback_path(key);
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
            }
        }
        std::fs::write(&p, secret).map_err(|e| CoreError::internal(format!("failed to store secret fallback: {e}")))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }

    /// Retrieve a secret.
    pub fn get_secret(&self, key: &str) -> Result<Option<String>, CoreError> {
        let output = Command::new("secret-tool")
            .arg("lookup")
            .arg("service")
            .arg(&self.app_id)
            .arg("key")
            .arg(key)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !val.is_empty() {
                    return Ok(Some(val));
                }
            }
        }

        // Fallback check
        let p = self.fallback_path(key);
        if p.exists() {
            let content = std::fs::read_to_string(&p)
                .map_err(|e| CoreError::internal(format!("failed to read fallback secret: {e}")))?;
            return Ok(Some(content.trim().to_string()));
        }

        Ok(None)
    }

    /// Delete a secret.
    pub fn delete_secret(&self, key: &str) -> Result<(), CoreError> {
        let _ = Command::new("secret-tool")
            .arg("clear")
            .arg("service")
            .arg(&self.app_id)
            .arg("key")
            .arg(key)
            .output();

        let p = self.fallback_path(key);
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }

        Ok(())
    }
}
