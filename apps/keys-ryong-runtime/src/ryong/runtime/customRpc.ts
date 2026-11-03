/**
 * Custom RPC adapter for the isolated development app.
 * Uses the existing connection and call_rpc mutex; never opens another port.
 */
import { Request } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../rpc/pipeline";
import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";

type Subsystem = { index: number; identifier: string };
type CustomResponse = {
  listCustomSubsystems?: { subsystems?: Subsystem[] };
  call?: { subsystemIndex?: number; payload?: Uint8Array };
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function request(body: object) {
  const req = Request.fromJSON({ custom: body });
  // Standard upstream 0.0.18 silently drops custom fields. Test the codec
  // before using the connection, rather than sending an empty/wrong request.
  const roundTrip: unknown = Request.decode(Request.encode(req).finish());
  if (!record(roundTrip) || !record(roundTrip.custom)) {
    throw new Error("This Studio client does not support runtime RPC. No request was sent.");
  }
  return req;
}

async function send(conn: RpcConnection, body: object): Promise<CustomResponse> {
  const req = request(body);
  const result: unknown = await call_rpc(conn, req);
  if (!record(result) || !record(result.custom)) {
    throw new Error("Device returned no custom RPC response.");
  }
  return result.custom as CustomResponse;
}

export async function discoverRuntime(conn: RpcConnection): Promise<Subsystem[]> {
  const response = await send(conn, { listCustomSubsystems: {} });
  const items = response.listCustomSubsystems?.subsystems;
  if (!Array.isArray(items) || items.length > 64) {
    throw new Error("Invalid runtime subsystem catalog.");
  }
  const ids = new Set<string>();
  const indices = new Set<number>();
  for (const item of items) {
    if (!item || typeof item.identifier !== "string" || !item.identifier ||
        !Number.isInteger(item.index) || item.index < 0 || item.index > 65535 ||
        ids.has(item.identifier) || indices.has(item.index)) {
      throw new Error("Ambiguous runtime subsystem catalog.");
    }
    ids.add(item.identifier);
    indices.add(item.index);
  }
  return items.map(item => ({ index: item.index, identifier: item.identifier }));
}

/** Both pinned proto schemas use field 1 (empty message) for list requests. */
export async function readRuntimeCatalogs(conn: RpcConnection) {
  const subsystems = await discoverRuntime(conn);
  const find = (identifier: string) => {
    const found = subsystems.find(item => item.identifier === identifier);
    if (!found) throw new Error("Missing runtime subsystem: " + identifier);
    return found.index;
  };
  // Resolve BOTH before any further request. Indices are device assigned.
  const comboIndex = find("cormoran__runtime_combo");
  const macroIndex = find("cormoran__runtime_macro");
  const read = async (subsystemIndex: number) => {
    const response = await send(conn, { call: { subsystemIndex, payload: "CgA=" } });
    if (response.call?.subsystemIndex !== subsystemIndex ||
        !(response.call.payload instanceof Uint8Array) ||
        response.call.payload.length > 65536) {
      throw new Error("Invalid runtime catalog response.");
    }
    return response.call.payload.slice();
  };
  // Serialize with the existing Studio queue. Never compete for its reader.
  return { combos: await read(comboIndex), macros: await read(macroIndex) };
}

/** Low-level payload exchange; device firmware still enforces Studio unlock. */
export async function callRuntimePayload(conn: RpcConnection, index: number, payload: Uint8Array) {
  if (!Number.isInteger(index) || index < 0 || index > 65535 || payload.length > 160) {
    throw new Error("Runtime request exceeds the validated transport bounds.");
  }
  const encoded = btoa(Array.from(payload, byte => String.fromCharCode(byte)).join(""));
  const response = await send(conn, { call: { subsystemIndex: index, payload: encoded } });
  if (response.call?.subsystemIndex !== index || !(response.call.payload instanceof Uint8Array)) {
    throw new Error("Mismatched runtime response.");
  }
  return response.call.payload;
}
