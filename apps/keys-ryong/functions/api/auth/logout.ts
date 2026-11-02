import { clearSession, json } from "../../_lib/session";

export const onRequestPost: PagesFunction = async () => json({ ok: true }, {}, clearSession());
