import { getSession, gh } from "../_lib/session";

// Latest successful firmware build of a branch, for repositories the signed-in person can reach
// (private ones included). Redirects to GitHub's short-lived download link.
export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const { s } = await getSession(request, env);
  if (!s) return new Response("Sign in first.", { status: 401 });
  const q = new URL(request.url).searchParams;
  const repo = q.get("repo") || "";
  const branch = q.get("branch") || "";
  const workflow = q.get("workflow") || "build.yml";
  const name = q.get("artifact") || "firmware";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return new Response("Bad repo", { status: 400 });

  const runs = (await (
    await gh(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=1`, s.token)
  ).json()) as { workflow_runs?: { id: number }[] };
  const run = runs.workflow_runs?.[0];
  if (!run) return new Response("No successful build yet.", { status: 404 });
  const arts = (await (await gh(`/repos/${repo}/actions/runs/${run.id}/artifacts?per_page=100`, s.token)).json()) as {
    artifacts?: { id: number; name: string; expired: boolean }[];
  };
  const art = arts.artifacts?.find((a) => a.name === name && !a.expired) || arts.artifacts?.find((a) => !a.expired);
  if (!art) return new Response("The build's files have expired. Run the build again.", { status: 404 });
  const dl = await gh(`/repos/${repo}/actions/artifacts/${art.id}/zip`, s.token, { redirect: "manual" });
  const loc = dl.headers.get("Location");
  if (!loc) return new Response("Couldn't get the download link.", { status: 502 });
  return new Response(null, { status: 302, headers: { Location: loc, "Cache-Control": "no-store" } });
};
