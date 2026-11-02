import { AdminEnv, configured, json, readCookie, verify } from "../../_lib/auth";
import { ref, repo } from "../../_lib/github";

/** Open endpoint: whether you're signed in and what is still missing in the setup (no secrets). */
export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) =>
  json({
    signedIn: await verify(env, readCookie(request)),
    setup: { password: configured(env), github: !!env.ADMIN_GITHUB_TOKEN },
    repo: repo(env), ref: ref(env),
  });
