import {
  Request,
  RequestResponse,
  RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc as inner_call_rpc } from "./pipeline";
import { reportRpcError } from "../ryong/RpcErrorToast";
import { t } from "../ryong/i18n";

/* Requests that change the keyboard: a failure is shown to the user (reads fail quietly - the
 * screen shows what it could load). */
function changeName(req: Omit<Request, "requestId">): string | undefined {
  const k = req.keymap;
  if (k?.saveChanges) return t("save the keymap", "키맵 저장");
  if (k?.discardChanges) return t("discard changes", "변경 취소");
  if (k?.setLayerBinding) return t("change the key", "키 변경");
  if (k?.addLayer || k?.removeLayer || k?.restoreLayer || k?.moveLayer || k?.setLayerProps) return t("change the layers", "레이어 변경");
  if (k?.setActivePhysicalLayout) return t("change the layout", "배열 변경");
  if (req.core?.resetSettings) return t("reset the settings", "설정 초기화");
  return undefined;
}

const DEBUG = (() => { try { return localStorage.getItem("ryong.debugRpc") === "1"; } catch { return false; } })();

export async function call_rpc(
  conn: RpcConnection,
  req: Omit<Request, "requestId">
): Promise<RequestResponse> {
  if (DEBUG) console.log("RPC Request", req);
  return inner_call_rpc(conn, req)
    .then((r) => {
      if (DEBUG) console.log("RPC Response", r);
      return r;
    })
    .catch((e) => {
      console.error("RPC Error", req, e);
      const what = changeName(req);
      if (what) reportRpcError(what, e);
      return e; // the original Studio screens expect a value, not an exception
    });
}
