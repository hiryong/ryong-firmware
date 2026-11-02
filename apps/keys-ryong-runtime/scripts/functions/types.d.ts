// Minimal Cloudflare Pages Functions types (kept local so package.json stays identical to upstream).
interface Env {
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_APP_SLUG: string;
  SESSION_SECRET: string;
  OWNERS?: string;
}
interface EventContext<P extends string = string> {
  request: Request;
  env: Env;
  params: Record<P, string | string[]>;
  waitUntil(p: Promise<unknown>): void;
}
type PagesFunction<P extends string = string> = (ctx: EventContext<P>) => Response | Promise<Response>;
