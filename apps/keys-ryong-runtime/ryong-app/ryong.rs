// keys.ryong.com desktop app: the window opens https://keys.ryong.com and the official ZMK Studio code
// (src-tauri) provides Bluetooth and USB. Copied into src-tauri/src at build time by prepare.mjs.

use std::path::PathBuf;
use tauri::webview::DownloadEvent;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

const SITE: &str = "https://keys.ryong.com/";

/// Pages that stay inside the app: the site itself, and GitHub for signing in.
fn stays_inside(url: &Url) -> bool {
    match url.scheme() {
        "blob" | "data" | "about" => true,
        "https" => match url.host_str() {
            Some(h) => h == "keys.ryong.com" || h == "github.com",
            None => false,
        },
        _ => false,
    }
}

fn open_outside(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let r = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let r = std::process::Command::new("xdg-open").arg(url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// The site asks for this when a link should open in the computer's browser.
#[tauri::command]
pub fn ryong_open(url: String) -> Result<(), String> {
    let u = Url::parse(&url).map_err(|e| e.to_string())?;
    if u.scheme() != "https" && u.scheme() != "http" {
        return Err("only web links".into());
    }
    open_outside(u.as_str())
}

fn unique(dir: &PathBuf, name: &std::ffi::OsStr) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let p = PathBuf::from(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("download").to_string();
    let ext = p.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    for i in 1..1000 {
        let c = dir.join(format!("{stem} ({i}){ext}"));
        if !c.exists() {
            return c;
        }
    }
    first
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let downloads = app.path().download_dir().ok();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse()?))
        .title("keys.ryong.com")
        .inner_size(1280.0, 820.0)
        .min_inner_size(760.0, 540.0)
        .on_navigation(|url| {
            if stays_inside(url) {
                return true;
            }
            let _ = open_outside(url.as_str());
            false
        })
        .on_download(move |_webview, event| {
            // backups and other files the page saves go to Downloads
            if let DownloadEvent::Requested { destination, .. } = event {
                if let (Some(dir), Some(name)) = (downloads.as_ref(), destination.file_name().map(|n| n.to_owned())) {
                    *destination = unique(dir, &name);
                }
            }
            true
        })
        .build()?;
    Ok(())
}
