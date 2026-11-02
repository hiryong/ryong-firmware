//! Verified UF2 transfer core. Release policies must be embedded by the publisher.
//! This validates application packages; it does not add secure boot to a bootloader.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
const DOMAIN: &[u8] = b"Ryong firmware package v1\0";
const MAX_PACKAGE: usize = 3 * 1024 * 1024;
const MAX_IMAGE: usize = 2 * 1024 * 1024;
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoardPolicy {
    pub model: String,
    pub board_id: String,
    pub family: u32,
    pub app_start: u32,
    pub app_end: u32,
    pub key_id: String,
    pub public_key: [u8; 32],
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub model: String,
    pub board_id: String,
    pub build_id: String,
    pub version: u64,
    pub image_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Package {
    manifest: String,
    image: String,
    signature: String,
    key_id: String,
}
pub struct VerifiedUpdate {
    manifest: Manifest,
    image: Vec<u8>,
    board_id: String,
}
impl VerifiedUpdate {
    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn word(block: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(block[offset..offset + 4].try_into().unwrap())
}
fn validate_uf2(image: &[u8], p: &BoardPolicy) -> Result<()> {
    if image.is_empty() || image.len() > MAX_IMAGE || image.len() % 512 != 0 {
        return Err("Invalid UF2 size".into());
    }
    if p.app_start >= p.app_end {
        return Err("Invalid board application range".into());
    }
    let count = image.len() / 512;
    let mut targets = HashSet::new();
    for (index, b) in image.chunks_exact(512).enumerate() {
        if word(b, 0) != 0x0a324655 || word(b, 4) != 0x9e5d5157 || word(b, 508) != 0x0ab16f30 {
            return Err("Invalid UF2 magic".into());
        }
        if word(b, 8) != 0x2000 || word(b, 28) != p.family {
            return Err("Unexpected UF2 flags/family".into());
        }
        if word(b, 16) != 256 || word(b, 20) != index as u32 || word(b, 24) != count as u32 {
            return Err("Invalid UF2 block ordering/length".into());
        }
        let target = word(b, 12);
        let end = target.checked_add(256).ok_or("UF2 address overflow")?;
        if target % 256 != 0 || target < p.app_start || end > p.app_end || !targets.insert(target) {
            return Err("UF2 touches a forbidden or repeated flash range".into());
        }
    }
    Ok(())
}
/// No filesystem writes, reboot or network access occur during verification.
pub fn verify_package(
    json: &str,
    policies: &[BoardPolicy],
    expected_model: &str,
    current_version: u64,
) -> Result<VerifiedUpdate> {
    if json.len() > MAX_PACKAGE {
        return Err("Package too large".into());
    }
    let package: Package = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if package.manifest.len() > 8192 {
        return Err("Manifest too large".into());
    }
    let manifest: Manifest = serde_json::from_str(&package.manifest).map_err(|e| e.to_string())?;
    if manifest.format != "ryong-firmware-v1"
        || manifest.model != expected_model
        || manifest.version <= current_version
        || manifest.build_id.is_empty()
        || manifest.build_id.len() > 64
        || !manifest.build_id.is_ascii()
    {
        return Err("Incompatible package or downgrade".into());
    }
    let p = policies
        .iter()
        .find(|p| {
            p.model == manifest.model
                && p.board_id == manifest.board_id
                && p.key_id == package.key_id
        })
        .ok_or("No validated release policy for this board/key")?;
    let signature_bytes = STANDARD
        .decode(&package.signature)
        .map_err(|e| e.to_string())?;
    let signature = Signature::from_slice(&signature_bytes).map_err(|e| e.to_string())?;
    let key = VerifyingKey::from_bytes(&p.public_key).map_err(|e| e.to_string())?;
    let mut message = DOMAIN.to_vec();
    message.extend_from_slice(package.manifest.as_bytes());
    key.verify_strict(&message, &signature)
        .map_err(|_| "Invalid firmware signature")?;
    let image = STANDARD.decode(&package.image).map_err(|e| e.to_string())?;
    if hex(&Sha256::digest(&image)) != manifest.image_sha256 {
        return Err("Firmware hash differs".into());
    }
    validate_uf2(&image, p)?;
    Ok(VerifiedUpdate {
        board_id: p.board_id.clone(),
        manifest,
        image,
    })
}
#[derive(Clone, Debug, Serialize)]
pub struct BootVolume {
    pub path: PathBuf,
    pub board_id: String,
    pub info: String,
}
fn read_info(root: &Path) -> Result<(String, String)> {
    let path = root.join("INFO_UF2.TXT");
    let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > 4096 {
        return Err("Invalid bootloader info file".into());
    }
    let mut info = String::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(4097)
        .read_to_string(&mut info)
        .map_err(|e| e.to_string())?;
    let ids: Vec<_> = info
        .lines()
        .filter_map(|l| l.strip_prefix("Board-ID:").map(str::trim))
        .collect();
    if ids.len() != 1 || ids[0].is_empty() || ids[0].len() > 160 {
        return Err("Missing or ambiguous bootloader board identity".into());
    }
    Ok((ids[0].to_string(), info))
}
/// Production callers supply only platform mount roots, never a page-provided path.
pub fn scan_roots(roots: &[PathBuf]) -> Vec<BootVolume> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        let candidates = if cfg!(windows) {
            vec![root.clone()]
        } else {
            fs::read_dir(root)
                .map(|items| items.filter_map(|e| e.ok().map(|v| v.path())).collect())
                .unwrap_or_default()
        };
        for path in candidates {
            if let Ok(path) = path.canonicalize() {
                if seen.insert(path.clone()) {
                    if let Ok((board_id, info)) = read_info(&path) {
                        result.push(BootVolume {
                            path,
                            board_id,
                            info,
                        });
                    }
                }
            }
        }
    }
    result
}
pub fn platform_roots() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return vec![PathBuf::from("/Volumes")];
    }
    #[cfg(target_os = "windows")]
    {
        return (b'D'..=b'Z')
            .map(|c| PathBuf::from(format!("{}:\\", c as char)))
            .collect();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}
/// A returned receipt means bytes were transferred, not that a new firmware booted.
/// The caller must reconnect and compare board/unit/build identity before success.
#[derive(Debug, Serialize)]
pub struct TransferReceipt {
    pub build_id: String,
    pub bytes: usize,
}
pub fn transfer(
    update: &VerifiedUpdate,
    volumes: &[BootVolume],
    mut progress: impl FnMut(usize, usize),
) -> Result<TransferReceipt> {
    let matches: Vec<_> = volumes
        .iter()
        .filter(|v| v.board_id == update.board_id)
        .collect();
    if matches.len() != 1 {
        return Err("Exactly one matching bootloader must be present".into());
    }
    let volume = matches[0];
    // Check identity again immediately before opening the fixed destination.
    if read_info(&volume.path)?.0 != update.board_id {
        return Err("Bootloader changed before transfer".into());
    }
    let file = volume.path.join("RYONG_UPDATE.UF2");
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)
        .map_err(|e| e.to_string())?;
    progress(0, update.image.len());
    let mut written = 0;
    for chunk in update.image.chunks(4096) {
        output
            .write_all(chunk)
            .map_err(|e| format!("Transfer interrupted after {written} bytes: {e}"))?;
        written += chunk.len();
        progress(written, update.image.len());
    }
    output
        .flush()
        .map_err(|e| format!("Transfer flush failed; reconnect to inspect: {e}"))?;
    output
        .sync_all()
        .map_err(|e| format!("Transfer sync failed; reconnect to inspect: {e}"))?;
    Ok(TransferReceipt {
        build_id: update.manifest.build_id.clone(),
        bytes: written,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn fixture() -> (BoardPolicy, Vec<u8>, SigningKey) {
        let key = SigningKey::from_bytes(&[7; 32]);
        let p = BoardPolicy {
            model: "test-board".into(),
            board_id: "TEST_ONLY".into(),
            family: 0x12345678,
            app_start: 0x1000,
            app_end: 0x2000,
            key_id: "test".into(),
            public_key: key.verifying_key().to_bytes(),
        };
        let mut image = vec![0u8; 512];
        for (off, value) in [
            (0, 0x0a324655u32),
            (4, 0x9e5d5157),
            (8, 0x2000),
            (12, 0x1000),
            (16, 256),
            (20, 0),
            (24, 1),
            (28, p.family),
            (508, 0x0ab16f30),
        ] {
            image[off..off + 4].copy_from_slice(&value.to_le_bytes());
        }
        (p, image, key)
    }
    fn package(p: &BoardPolicy, image: &[u8], key: &SigningKey) -> String {
        let manifest = serde_json::to_string(&Manifest {
            format: "ryong-firmware-v1".into(),
            model: p.model.clone(),
            board_id: p.board_id.clone(),
            build_id: "test-build".into(),
            version: 2,
            image_sha256: hex(&Sha256::digest(image)),
        })
        .unwrap();
        let mut signed = DOMAIN.to_vec();
        signed.extend_from_slice(manifest.as_bytes());
        serde_json::json!({"manifest":manifest,"image":STANDARD.encode(image),"signature":STANDARD.encode(key.sign(&signed).to_bytes()),"key_id":p.key_id}).to_string()
    }
    #[test]
    fn crypto_identity_downgrade_and_ranges() {
        let (p, image, key) = fixture();
        let json = package(&p, &image, &key);
        assert!(verify_package(&json, &[p.clone()], "test-board", 1).is_ok());
        assert!(verify_package(&json, &[], "test-board", 1).is_err());
        assert!(verify_package(&json, &[p.clone()], "other", 1).is_err());
        assert!(verify_package(&json, &[p.clone()], "test-board", 2).is_err());
        let mut wrong = p.clone();
        wrong.public_key = [1; 32];
        assert!(verify_package(&json, &[wrong], "test-board", 1).is_err());
        let mut bad = image.clone();
        bad[12..16].copy_from_slice(&0u32.to_le_bytes());
        assert!(verify_package(&package(&p, &bad, &key), &[p.clone()], "test-board", 1).is_err());
        bad = image.clone();
        bad[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert!(verify_package(&package(&p, &bad, &key), &[p.clone()], "test-board", 1).is_err());
        bad = image.clone();
        bad[28..32].copy_from_slice(&1u32.to_le_bytes());
        assert!(verify_package(&package(&p, &bad, &key), &[p.clone()], "test-board", 1).is_err());
        let mut v: serde_json::Value = serde_json::from_str(&json).unwrap();
        v["image"] = serde_json::Value::String(STANDARD.encode(bad));
        assert!(verify_package(&v.to_string(), &[p], "test-board", 1).is_err());
    }
    #[test]
    fn transfer_rechecks_identity_and_never_overwrites() {
        let (p, image, key) = fixture();
        let verified = verify_package(&package(&p, &image, &key), &[p], "test-board", 1).unwrap();
        let root = std::env::temp_dir().join(format!("ryong-updater-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir(&root).unwrap();
        fs::write(root.join("INFO_UF2.TXT"), "Board-ID: TEST_ONLY\n").unwrap();
        let volume = BootVolume {
            path: root.clone(),
            board_id: "TEST_ONLY".into(),
            info: String::new(),
        };
        assert!(transfer(&verified, &[], |_, _| {}).is_err());
        assert!(transfer(&verified, &[volume.clone(), volume.clone()], |_, _| {}).is_err());
        let mut seen = Vec::new();
        let receipt = transfer(&verified, &[volume.clone()], |n, total| {
            seen.push((n, total))
        })
        .unwrap();
        assert_eq!(receipt.bytes, 512);
        assert_eq!(fs::read(root.join("RYONG_UPDATE.UF2")).unwrap(), image);
        assert_eq!(seen, vec![(0, 512), (512, 512)]);
        assert!(transfer(&verified, &[volume.clone()], |_, _| {}).is_err());
        fs::remove_file(root.join("RYONG_UPDATE.UF2")).unwrap();
        fs::write(root.join("INFO_UF2.TXT"), "Board-ID: WRONG\n").unwrap();
        assert!(transfer(&verified, &[volume], |_, _| {}).is_err());
        assert!(!root.join("RYONG_UPDATE.UF2").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
