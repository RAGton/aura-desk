//! Pure GitHub Releases auto-update domain helpers (SemVer, asset selection, SHA-256 verification).

#![allow(missing_docs)]

use std::collections::HashMap;
use std::fmt::Write;

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Canonical GitHub owner/repository monitored for AuraDesk releases.
pub const GITHUB_OWNER: &str = "RAGton";
pub const GITHUB_REPO: &str = "aura-desk";

/// Minimal release asset metadata parsed from GitHub Releases API responses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
}

/// Strip an optional leading `v`/`V` tag prefix and parse strict SemVer.
pub fn parse_release_version(tag: &str) -> Result<Version, String> {
    let normalized = tag.trim().trim_start_matches(['v', 'V']);
    Version::parse(normalized).map_err(|e| format!("invalid release version '{tag}': {e}"))
}

/// Return `true` only when `remote_tag` parses cleanly and is strictly newer than `current`.
pub fn is_newer_version(current: &str, remote_tag: &str) -> bool {
    let Ok(cur) = parse_release_version(current) else {
        return false;
    };
    let Ok(rem) = parse_release_version(remote_tag) else {
        return false;
    };
    rem.pre.is_empty() && rem > cur
}

/// Restrict downloads strictly to HTTPS GitHub Release asset endpoints for this repository.
pub fn is_trusted_release_download_url(url: &str) -> bool {
    let trimmed = url.trim();
    let repo_prefix = format!("https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/");
    trimmed.starts_with(&repo_prefix)
        || trimmed.starts_with("https://objects.githubusercontent.com/")
        || trimmed.starts_with("https://release-assets.githubusercontent.com/")
}

/// Pick the best installer asset for the active OS/architecture pair.
pub fn select_platform_asset<'a>(
    assets: &'a [ReleaseAsset],
    os: &str,
    arch: &str,
) -> Option<&'a ReleaseAsset> {
    let trusted: Vec<&ReleaseAsset> = assets
        .iter()
        .filter(|a| is_trusted_release_download_url(&a.download_url))
        .collect();

    match os {
        "windows" => trusted
            .iter()
            .copied()
            .find(|a| {
                let low = a.name.to_ascii_lowercase();
                low.ends_with("-setup.exe") || low.ends_with("_setup.exe")
            })
            .or_else(|| {
                trusted
                    .iter()
                    .copied()
                    .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
            })
            .or_else(|| {
                trusted
                    .iter()
                    .copied()
                    .find(|a| a.name.to_ascii_lowercase().ends_with(".msi"))
            }),
        "linux" => trusted
            .iter()
            .copied()
            .find(|a| a.name.to_ascii_lowercase().ends_with(".appimage"))
            .or_else(|| {
                trusted
                    .iter()
                    .copied()
                    .find(|a| a.name.to_ascii_lowercase().ends_with(".deb"))
            }),
        "macos" => {
            let prefer_arm = arch == "aarch64";
            trusted
                .iter()
                .copied()
                .find(|a| {
                    let low = a.name.to_ascii_lowercase();
                    if !low.ends_with(".dmg") {
                        return false;
                    }
                    if prefer_arm {
                        low.contains("aarch64") || low.contains("arm64")
                    } else {
                        low.contains("x64") || low.contains("x86_64") || low.contains("intel")
                    }
                })
                .or_else(|| {
                    trusted
                        .iter()
                        .copied()
                        .find(|a| a.name.to_ascii_lowercase().ends_with(".dmg"))
                })
        }
        _ => None,
    }
}

/// Parse standard `sha256sum` output (`<64-hex>  <filename>`) keyed by lowercase basename.
pub fn parse_sha256_sums(contents: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(hash_raw) = parts.next() else {
            continue;
        };
        let Some(name_raw) = parts.next() else {
            continue;
        };
        let hash = hash_raw.trim().to_ascii_lowercase();
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        let cleaned_name = name_raw.trim().trim_start_matches('*');
        let basename = cleaned_name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(cleaned_name)
            .to_ascii_lowercase();
        if !basename.is_empty() {
            map.insert(basename, hash);
        }
    }
    map
}

/// Compute lowercase hex SHA-256 of `bytes` and verify constant-case match against `expected_hex`.
pub fn verify_sha256_bytes(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    let expected = expected_hex.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid expected sha256 digest format".to_string());
    }
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut actual = String::with_capacity(64);
    for b in digest {
        let _ = write!(&mut actual, "{b:02x}");
    }
    if actual != expected {
        return Err(format!(
            "sha256 mismatch: expected {expected}, got {actual}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_release_versions_and_blocks_downgrades() {
        assert!(is_newer_version("0.2.1", "v0.2.2"));
        assert!(is_newer_version("0.2.1", "0.3.0"));
        assert!(!is_newer_version("0.2.1", "v0.2.1"));
        assert!(!is_newer_version("0.2.2", "v0.2.1"));
        assert!(!is_newer_version("0.2.1", "v0.2.2-rc.1"));
        assert!(!is_newer_version("0.2.1", "not-a-semver"));
    }

    #[test]
    fn selects_expected_platform_installer_and_rejects_untrusted_urls() {
        let base = "https://github.com/RAGton/aura-desk/releases/download/v0.2.2";
        let assets = vec![
            ReleaseAsset {
                name: "AuraDesk_0.2.2_x64_en-US.msi".into(),
                download_url: format!("{base}/AuraDesk_0.2.2_x64_en-US.msi"),
                size: 100,
            },
            ReleaseAsset {
                name: "AuraDesk_0.2.2_x64-setup.exe".into(),
                download_url: format!("{base}/AuraDesk_0.2.2_x64-setup.exe"),
                size: 120,
            },
            ReleaseAsset {
                name: "AuraDesk_0.2.2_amd64.AppImage".into(),
                download_url: format!("{base}/AuraDesk_0.2.2_amd64.AppImage"),
                size: 140,
            },
            ReleaseAsset {
                name: "AuraDesk_0.2.2_aarch64.dmg".into(),
                download_url: format!("{base}/AuraDesk_0.2.2_aarch64.dmg"),
                size: 160,
            },
            ReleaseAsset {
                name: "evil-setup.exe".into(),
                download_url: "https://evil.example.com/evil-setup.exe".into(),
                size: 10,
            },
        ];

        assert_eq!(
            select_platform_asset(&assets, "windows", "x86_64")
                .unwrap()
                .name,
            "AuraDesk_0.2.2_x64-setup.exe"
        );
        assert_eq!(
            select_platform_asset(&assets, "linux", "x86_64")
                .unwrap()
                .name,
            "AuraDesk_0.2.2_amd64.AppImage"
        );
        assert_eq!(
            select_platform_asset(&assets, "macos", "aarch64")
                .unwrap()
                .name,
            "AuraDesk_0.2.2_aarch64.dmg"
        );
        assert!(!is_trusted_release_download_url(
            "http://github.com/RAGton/aura-desk/releases/download/v0.2.2/a.exe"
        ));
    }

    #[test]
    fn parses_and_verifies_sha256_sums() {
        let payload = b"auradesk-release-binary";
        let mut hasher = Sha256::new();
        hasher.update(payload);
        let digest = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();

        let sums = format!("# release checksums\n{digest} *bundle/AuraDesk_0.2.2_x64-setup.exe\n");
        let parsed = parse_sha256_sums(&sums);
        let expected = parsed.get("auradesk_0.2.2_x64-setup.exe").unwrap();
        verify_sha256_bytes(payload, expected).unwrap();
        assert!(verify_sha256_bytes(b"tampered", expected).is_err());
    }
}
