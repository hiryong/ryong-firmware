import { getSession, gh } from "../../_lib/session";

// GitHub API on behalf of the signed-in person. The token never reaches the page.
// Reads: anything the token can see. Writes: only file commits and refs inside repositories.
const WRITE_OK = /^\/repos\/[^/]+\/[^/]+\/(git\/(trees|commits|refs\/heads\/.+)|contents\/.+)$/;

export const onRequest: PagesFunction<"path"> = async ({ request, env, params }) => {
  const { s, setCookie } = await getSession(request, env);
  if (!s) return new Response(JSON.stringify({ message: "Sign in first." }), { status: 401, headers: { "Content-Type": "application/json" } });

  const segs = Array.isArray(params.path) ? params.path : [params.path];
  const path = "/" + segs.map(encodeURIComponent).join("/") + new URL(request.url).search;
  const method = request.method.toUpperCase();
  if (!["GET", "HEAD"].includes(method) && !WRITE_OK.test(path.split("?")[0])) {
    return new Response(JSON.stringify({ message: "Not allowed." }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  // Same-origin requests only for writes (no cross-site form posts).
  if (method !== "GET" && request.headers.get("Origin") && request.headers.get("Origin") !== new URL(request.url).origin) {
    return new Response("Bad origin", { status: 403 });
  }

  const r = await gh(path, s.token, { method, body: ["GET", "HEAD"].includes(method) ? undefined : await request.text() });
  const h = new Headers({ "Content-Type": r.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" });
  if (setCookie) h.append("Set-Cookie", setCookie);
  return new Response(r.body, { status: r.status, headers: h });
};
