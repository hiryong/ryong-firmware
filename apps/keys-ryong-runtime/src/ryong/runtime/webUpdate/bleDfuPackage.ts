/** The build's Bluetooth update package (adafruit-nrfutil `dfu genpkg`, legacy DFU 0.5):
 * manifest.json + <app>.bin + <app>.dat. Read in the browser and checked before anything is sent:
 * application only (no SoftDevice or bootloader parts), size within the nRF52840 application area,
 * device type 0x0052 and the image CRC matching its init packet and manifest. */
import {unzipSync, strFromU8} from "three/examples/jsm/libs/fflate.module.js";
import {crc16} from "./serialDfuCodec";

export type BleDfuPackage = {name: string; target: string | null; application: Uint8Array; init: Uint8Array};

/** build targets, longest first (the file name starts with one: bt60-r123-abc1234-bluetooth.zip) */
export const BUILD_TARGETS = ["bt60-oreo", "bt60", "geist"] as const;
export const TARGET_NAMES: Record<string, string> = {"bt60": "BT60 (Cheeto)", "bt60-oreo": "BT60 (Oreo)", "geist": "geist"};
/** application area of the Adafruit bootloader with S140: 0x26000 .. 0xF4000 */
const MAX_APPLICATION = 0xf4000 - 0x26000;

export function readBleDfuPackage(name: string, zip: Uint8Array): BleDfuPackage {
  if (zip.length > 2 * 1024 * 1024) throw Error("This file is too large to be a keyboard update.");
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw Error("This is not a zip file. Choose the build's file ending in -bluetooth.zip."); }
  const manifestFile = files["manifest.json"];
  if (!manifestFile) throw Error("No manifest.json inside. Choose the build's file ending in -bluetooth.zip.");
  let manifest: {manifest?: Record<string, {bin_file?: string; dat_file?: string; init_packet_data?: {device_type?: number; firmware_crc16?: number}}>};
  try { manifest = JSON.parse(strFromU8(manifestFile)); } catch { throw Error("manifest.json is not readable."); }
  const parts = manifest.manifest ?? {};
  const kinds = Object.keys(parts).filter((k) => k !== "dfu_version");
  if (kinds.length !== 1 || kinds[0] !== "application") throw Error("This package updates more than the keyboard firmware (SoftDevice or bootloader). Not sent.");
  const app = parts.application;
  const bin = app.bin_file && files[app.bin_file], dat = app.dat_file && files[app.dat_file];
  if (!bin || !dat) throw Error("The firmware or its init packet is missing from the package.");
  if (bin.length < 1 || bin.length > MAX_APPLICATION) throw Error("The firmware size does not fit the keyboard's application area.");
  if (dat.length < 12 || dat.length > 64) throw Error("The init packet has an unexpected size.");
  const v = new DataView(dat.buffer, dat.byteOffset, dat.byteLength);
  const deviceType = v.getUint16(0, true), datCrc = v.getUint16(dat.length - 2, true), crc = crc16(bin);
  if (deviceType !== 0x0052 || app.init_packet_data?.device_type !== 0x0052) throw Error("This package is not for an nRF52 keyboard.");
  if (crc !== datCrc || app.init_packet_data?.firmware_crc16 !== crc) throw Error("The firmware does not match its checksum. The file may be damaged.");
  const base = name.split(/[\\/]/).pop() ?? name;
  const target = BUILD_TARGETS.find((t) => base.startsWith(t + "-r")) ?? null;
  return {name: base, target, application: bin, init: dat};
}
