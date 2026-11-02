//! Native adapter. No board has release approval or an embedded production key yet.
use ryong_updater::{BoardPolicy, Manifest, TransferReceipt};
use serde::Serialize;
use tauri::{command, AppHandle, Emitter};
fn policies() -> Result<Vec<BoardPolicy>, String> {
    serde_json::from_str(include_str!("../release-policy.json")).map_err(|e| e.to_string())
}
#[derive(Serialize)]
pub struct Capabilities {
    automatic_updates_ready: bool,
    validated_models: Vec<String>,
}
#[command]
pub fn firmware_update_capabilities() -> Result<Capabilities, String> {
    let p = policies()?;
    Ok(Capabilities {
        automatic_updates_ready: !p.is_empty(),
        validated_models: p.into_iter().map(|p| p.model).collect(),
    })
}
#[derive(Serialize)]
pub struct BootloaderInfo {
    board_id: String,
    info: String,
}
#[command]
pub async fn firmware_bootloader_inventory() -> Result<Vec<BootloaderInfo>, String> {
    Ok(blocking::unblock(|| {
        ryong_updater::scan_roots(&ryong_updater::platform_roots())
            .into_iter()
            .map(|v| BootloaderInfo {
                board_id: v.board_id,
                info: v.info,
            })
            .collect()
    })
    .await)
}
#[command]
pub async fn firmware_verify_package(
    package_json: String,
    expected_model: String,
    current_version: u64,
) -> Result<Manifest, String> {
    blocking::unblock(move || {
        let verified = ryong_updater::verify_package(
            &package_json,
            &policies()?,
            &expected_model,
            current_version,
        )?;
        Ok(verified.manifest().clone())
    })
    .await
}
#[command]
pub async fn firmware_transfer_package(
    package_json: String,
    expected_model: String,
    current_version: u64,
    app_handle: AppHandle,
) -> Result<TransferReceipt, String> {
    blocking::unblock(move || {
        // Verification is repeated natively immediately before touching a volume.
        // The frontend cannot pass a filesystem destination or a trusted public key.
        let verified = ryong_updater::verify_package(
            &package_json,
            &policies()?,
            &expected_model,
            current_version,
        )?;
        let volumes = ryong_updater::scan_roots(&ryong_updater::platform_roots());
        ryong_updater::transfer(&verified, &volumes, |written, total| {
            let _ = app_handle.emit("firmware_update_progress", (written, total));
        })
    })
    .await
}
