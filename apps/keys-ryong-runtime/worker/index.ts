// keys.ryong.com on Cloudflare Workers (moved from Pages on 2026-11-09).
// The site is static assets (wrangler.jsonc: SPA fallback, _headers honoured); only /api/* runs
// this code first. The admin API keeps its Pages Functions files (admin-functions/) unchanged:
// this small router gives each handler the same { request, env, params, next } it had on Pages,
// including the /api/admin _middleware (sign-in check, error mapping).
import type { AdminEnv } from "../admin-functions/_lib/auth";
import { onRequest as middleware } from "../admin-functions/api/admin/_middleware";
import * as login from "../admin-functions/api/admin/login";
import * as logout from "../admin-functions/api/admin/logout";
import * as me from "../admin-functions/api/admin/me";
import * as overview from "../admin-functions/api/admin/overview";
import * as releases from "../admin-functions/api/admin/releases";
import * as builds from "../admin-functions/api/admin/builds/index";
import * as build from "../admin-functions/api/admin/builds/[id]";
import * as download from "../admin-functions/api/admin/builds/[id]/download";
import * as validation from "../admin-functions/api/admin/validation/[id]";

type Env = AdminEnv & { ASSETS: Fetcher };
type Handler = (ctx: any) => Response | Promise<Response>;
type Module = Partial<Record<"onRequest" | "onRequestGet" | "onRequestPost" | "onRequestPut", Handler>>;

/* Same paths as the Pages file routes. */
const ROUTES: [RegExp, Module][] = [
  [/^\/api\/admin\/login$/, login],
  [/^\/api\/admin\/logout$/, logout],
  [/^\/api\/admin\/me$/, me],
  [/^\/api\/admin\/overview$/, overview],
  [/^\/api\/admin\/releases$/, releases],
  [/^\/api\/admin\/builds$/, builds],
  [/^\/api\/admin\/builds\/(?<id>[^/]+)$/, build],
  [/^\/api\/admin\/builds\/(?<id>[^/]+)\/download$/, download],
  [/^\/api\/admin\/validation\/(?<id>[^/]+)$/, validation],
];

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const path = url.pathname.replace(/\/+$/, "");
    for (const [re, mod] of ROUTES) {
      const m = re.exec(path);
      if (!m) continue;
      const method = request.method.toUpperCase();
      const key = ("onRequest" + method[0] + method.slice(1).toLowerCase()) as keyof Module;
      const handler = mod[key] ?? mod.onRequest ?? (method === "HEAD" ? mod.onRequestGet : undefined);
      const params = { ...(m.groups ?? {}) };
      const base = { request, env, params, waitUntil: ctx.waitUntil.bind(ctx), data: {}, functionPath: path };
      const run = () => handler ? handler({ ...base, next: () => { throw new Error("no next"); } })
        : json({ error: "Method not allowed" }, 405);
      if (!path.startsWith("/api/admin/")) return run();
      return middleware({ ...base, next: async () => run() } as never);
    }
    return json({ error: "Not found" }, 404);
  },
};
