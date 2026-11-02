import { clearCookie, json } from "../../_lib/auth";
export const onRequestPost: PagesFunction = async () => json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
