import { getSession, gh, json } from "../_lib/session";

// Who is signed in, and which repositories they let this site use.
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const base = { app: env.GITHUB_APP_SLUG || null };
  if (!env.GITHUB_CLIENT_ID || !env.SESSION_SECRET) return json({ ...base, user: null, enabled: false });
  const { s, setCookie } = await getSession(request, env);
  if (!s) return json({ ...base, user: null, enabled: true }, {}, setCookie);

  const u = await gh("/user", s.token);
  if (u.status === 401) return json({ ...base, user: null, enabled: true }, {}, "ry_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  const user = (await u.json()) as { login: string; avatar_url: string; name: string | null };

  // Repositories reachable through the app's installations for this user.
  const repos: { full_name: string; private: boolean; default_branch: string }[] = [];
  const inst = (await (await gh("/user/installations?per_page=100", s.token)).json()) as { installations?: { id: number }[] };
  for (const i of inst.installations || []) {
    const r = (await (await gh(`/user/installations/${i.id}/repositories?per_page=100`, s.token)).json()) as {
      repositories?: { full_name: string; private: boolean; default_branch: string }[];
    };
    for (const x of r.repositories || []) repos.push({ full_name: x.full_name, private: x.private, default_branch: x.default_branch });
  }
  const owners = (env.OWNERS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return json(
    {
      ...base,
      enabled: true,
      user: { login: user.login, name: user.name, avatar: user.avatar_url, owner: owners.includes(user.login.toLowerCase()) },
      repos,
    },
    {},
    setCookie
  );
};
