// Turns the official ZMK Studio desktop app (src-tauri) into the keys.ryong.com app, at build time only.
// Nothing here is committed into src-tauri, so official updates keep merging cleanly.
//
// - adds src/ryong.rs: a window that opens https://keys.ryong.com, opens other sites in the browser,
//   saves downloads to Downloads
// - lets keys.ryong.com (and only it) use the app's Bluetooth/USB commands (Tauri needs a list of the
//   app's commands for that, read here from main.rs so new official commands are picked up)
// Run from the repository root: node ryong-app/prepare.mjs

import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const T = "src-tauri";
const must = (s, find, what) => {
  if (!s.includes(find)) throw new Error(`ryong-app: can't find ${what} in ${T}/src/main.rs — the official app changed; update ryong-app/prepare.mjs`);
};

// 1. main.rs: our window, our command
let main = readFileSync(`${T}/src/main.rs`, "utf8");
must(main, "mod transport;", "`mod transport;`");
must(main, "tauri::Builder::default()", "`tauri::Builder::default()`");
must(main, "tauri::generate_handler![", "`tauri::generate_handler![`");
main = main
  .replace("mod transport;", "mod transport;\nmod ryong;")
  .replace("tauri::Builder::default()", "tauri::Builder::default()\n        .setup(ryong::setup)")
  .replace("tauri::generate_handler![", "tauri::generate_handler![\n            ryong::ryong_open,");
writeFileSync(`${T}/src/main.rs`, main);
copyFileSync("ryong-app/ryong.rs", `${T}/src/ryong.rs`);

// 2. the app's commands, so a capability can hand them to keys.ryong.com
const list = main.slice(main.indexOf("generate_handler![") + "generate_handler![".length);
const commands = list
  .slice(0, list.indexOf("]"))
  .split(",")
  .map((s) => s.trim().split("::").pop())
  .filter(Boolean);
writeFileSync(
  `${T}/build.rs`,
  `fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&[${commands.map((c) => `"${c}"`).join(", ")}])),
    )
    .expect("failed to run tauri-build");
}
`
);

writeFileSync(
  `${T}/capabilities/ryong-remote.json`,
  JSON.stringify(
    {
      identifier: "ryong-remote",
      description: "keys.ryong.com may use the keyboard connection (Bluetooth, USB) and nothing else",
      windows: ["main"],
      remote: { urls: ["https://keys.ryong.com/*"] },
      permissions: ["core:event:default", ...commands.map((c) => `allow-${c.replace(/_/g, "-")}`)],
    },
    null,
    2
  ) + "\n"
);

console.log("ryong-app: commands for keys.ryong.com:", commands.join(", "));
