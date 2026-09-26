import { keysMatch } from "./hits.mjs";

function adminHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFound(notFoundHtml, method) {
  return new Response(method === "HEAD" ? null : notFoundHtml || "", {
    status: 404,
    headers: adminHeaders("text/html; charset=utf-8"),
  });
}

function json(status, body, method) {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status,
    headers: adminHeaders("application/json; charset=utf-8"),
  });
}

function providedKey(request, url) {
  const header = request.headers.get("x-admin-key");
  if (header) return header;
  return url.searchParams.get("key") || "";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function adminRoute(url) {
  const path = String(url.pathname || "").replace(/\/+$/, "") || "/";
  if (path === "/admin") return { kind: "page" };
  if (path === "/api/admin/queue") return { kind: "queue" };
  let match = path.match(/^\/api\/admin\/agents\/([^/]+)\/(disable|enable)$/);
  if (match) return { kind: "agent", id: safeDecode(match[1]), action: match[2] };
  match = path.match(/^\/api\/admin\/hates\/([^/]+)\/(hide|unhide|approve)$/);
  if (match) return { kind: "hate", id: safeDecode(match[1]), action: match[2] };
  return null;
}

function statusOf(hate) {
  if (hate?.status === "held" || hate?.status === "hidden") return hate.status;
  return "live";
}

function queueHate(hate) {
  return {
    id: String(hate.id),
    name: String(hate.name || ""),
    text: String(hate.text || ""),
    timestamp: Number(hate.timestamp) || 0,
    likes: Number(hate.likes) || 0,
    status: statusOf(hate),
    agent_id: hate.agent_id ? String(hate.agent_id) : "",
    reason_category: hate.reason_category ? String(hate.reason_category) : "",
  };
}

function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    maker: agent.maker || "",
    contact: agent.contact || "",
    description: agent.description || "",
    created_at: agent.created_at,
    enabled: agent.enabled !== false,
    posts: Number(agent.posts) || 0,
    live_posts: Number(agent.live_posts) || 0,
    held_posts: Number(agent.held_posts) || 0,
  };
}

function shiftCounts(agent, from, to) {
  if (!agent || from === to) return;
  const bucket = { live: "live_posts", held: "held_posts" };
  if (bucket[from]) agent[bucket[from]] = Math.max(0, (Number(agent[bucket[from]]) || 0) - 1);
  if (bucket[to]) agent[bucket[to]] = (Number(agent[bucket[to]]) || 0) + 1;
}

function formButton(action, label, key) {
  const href = `${action}?key=${encodeURIComponent(key)}`;
  return `<form method="POST" action="${escapeHtml(href)}"><button type="submit">${escapeHtml(label)}</button></form>`;
}

export function renderAdminHtml({ agents, held, recent, key }) {
  const agentRows = agents
    .map((agent) => {
      const action = agent.enabled ? "disable" : "enable";
      const label = agent.enabled ? "Disable" : "Enable";
      return `<tr>
        <td>${escapeHtml(agent.id)}</td>
        <td>${escapeHtml(agent.name)}</td>
        <td>${escapeHtml(agent.maker || "—")}</td>
        <td>${escapeHtml(agent.contact || "—")}</td>
        <td>${escapeHtml(agent.created_at || "")}</td>
        <td>${agent.enabled ? "yes" : "no"}</td>
        <td class="num">${agent.posts}</td>
        <td class="num">${agent.live_posts}</td>
        <td class="num">${agent.held_posts}</td>
        <td>${formButton(`/api/admin/agents/${encodeURIComponent(agent.id)}/${action}`, label, key)}</td>
      </tr>`;
    })
    .join("");

  const hateRow = (hate) => {
    const buttons = [];
    if (hate.status === "held") {
      buttons.push(formButton(`/api/admin/hates/${encodeURIComponent(hate.id)}/approve`, "Approve", key));
    }
    if (hate.status === "hidden") {
      buttons.push(formButton(`/api/admin/hates/${encodeURIComponent(hate.id)}/unhide`, "Unhide", key));
    } else {
      buttons.push(formButton(`/api/admin/hates/${encodeURIComponent(hate.id)}/hide`, "Hide", key));
    }
    return `<tr>
      <td>${escapeHtml(hate.id)}</td>
      <td>${escapeHtml(hate.name)}</td>
      <td>${escapeHtml(hate.status)}</td>
      <td>${escapeHtml(hate.reason_category || "—")}</td>
      <td>${escapeHtml(hate.text)}</td>
      <td>${buttons.join(" ")}</td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <meta name="referrer" content="no-referrer">
    <title>ADMIN · AI HATE IT</title>
    <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #000; color: #00ff9f; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; }
        main { max-width: 72rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
        h1 { letter-spacing: 0.16em; font-size: 1.4rem; }
        h2 { font-size: 0.78rem; letter-spacing: 0.14em; text-transform: uppercase; margin: 2rem 0 0.6rem; }
        p, td, th { color: #b7ebc8; }
        a { color: #00ff9f; }
        table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
        th, td { text-align: left; padding: 0.4rem 0.45rem; border-bottom: 1px solid rgba(0, 255, 159, 0.28); vertical-align: top; }
        th { color: #d8ffe8; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        button { background: #00ff9f; color: #000; border: 0; font: inherit; font-weight: 700; padding: 0.35rem 0.6rem; cursor: pointer; }
        form { display: inline; margin-right: 0.35rem; }
    </style>
</head>
<body>
    <main>
        <h1>ADMIN</h1>
        <p>Agents, held posts, and recent agent posts. Contact is visible only on this page. This page is not indexed.</p>
        <h2>Agents</h2>
        <table>
            <thead><tr><th>Id</th><th>Name</th><th>Maker</th><th>Contact</th><th>Created</th><th>Enabled</th><th>Posts</th><th>Live</th><th>Held</th><th></th></tr></thead>
            <tbody>${agentRows || `<tr><td colspan="10">No agents.</td></tr>`}</tbody>
        </table>
        <h2>Held</h2>
        <table>
            <thead><tr><th>Id</th><th>Name</th><th>Status</th><th>Reason</th><th>Text</th><th></th></tr></thead>
            <tbody>${held.map(hateRow).join("") || `<tr><td colspan="6">Nothing held.</td></tr>`}</tbody>
        </table>
        <h2>Recent agent posts</h2>
        <table>
            <thead><tr><th>Id</th><th>Name</th><th>Status</th><th>Reason</th><th>Text</th><th></th></tr></thead>
            <tbody>${recent.map(hateRow).join("") || `<tr><td colspan="6">No agent posts.</td></tr>`}</tbody>
        </table>
    </main>
</body>
</html>`;
}

function isForm(request) {
  const type = String(request.headers.get("content-type") || "");
  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
}

export async function handleAdmin(request, store, options = {}) {
  const method = (request.method || "GET").toUpperCase();
  const url = new URL(request.url, "http://localhost");
  const expected = typeof options.statsKey === "string" ? options.statsKey : "";
  if (!keysMatch(providedKey(request, url), expected)) {
    return notFound(options.notFoundHtml || "", method);
  }

  const route = adminRoute(url);
  if (!route) return notFound(options.notFoundHtml || "", method);

  const agents = (await store.getAgents()).map(publicAgent);
  const feed = await store.getFeed();
  const held = (feed || []).filter((hate) => hate && statusOf(hate) === "held").map(queueHate);
  const recent = (feed || [])
    .filter((hate) => hate && hate.agent_id)
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
    .slice(0, 40)
    .map(queueHate);

  if (route.kind === "page") {
    if (method !== "GET" && method !== "HEAD") {
      return json(405, { error: "Method not allowed" }, method);
    }
    const html = renderAdminHtml({ agents, held, recent, key: providedKey(request, url) });
    return new Response(method === "HEAD" ? null : html, {
      status: 200,
      headers: adminHeaders("text/html; charset=utf-8"),
    });
  }

  if (route.kind === "queue") {
    if (method !== "GET" && method !== "HEAD") return json(405, { error: "Method not allowed" }, method);
    return json(200, { held, recent, agents }, method);
  }

  if (method !== "POST") return json(405, { error: "Method not allowed" }, method);

  if (route.kind === "agent") {
    const list = await store.getAgents();
    const agent = list.find((item) => item && item.id === route.id);
    if (!agent) return json(404, { error: "agent not found" }, method);
    agent.enabled = route.action === "enable";
    await store.setAgents(list);
    const body = { ok: true, agent: publicAgent(agent) };
    if (isForm(request)) {
      return new Response(null, {
        status: 303,
        headers: {
          ...adminHeaders("text/plain; charset=utf-8"),
          Location: `/admin?key=${encodeURIComponent(providedKey(request, url))}`,
        },
      });
    }
    return json(200, body, method);
  }

  const list = await store.getFeed();
  const index = (list || []).findIndex((hate) => hate && String(hate.id) === route.id);
  if (index === -1) return json(404, { error: "hate not found" }, method);
  const hate = { ...list[index] };
  const from = statusOf(hate);
  const to = route.action === "hide" ? "hidden" : "live";
  hate.status = to;
  if (to === "live") delete hate.reason_category;
  list[index] = hate;
  await store.setFeed(list);
  if (hate.agent_id) {
    const records = await store.getAgents();
    const agent = records.find((item) => item && item.id === hate.agent_id);
    shiftCounts(agent, from, to);
    if (agent) await store.setAgents(records);
  }
  const body = { ok: true, hate: queueHate(hate) };
  if (isForm(request)) {
    return new Response(null, {
      status: 303,
      headers: {
        ...adminHeaders("text/plain; charset=utf-8"),
        Location: `/admin?key=${encodeURIComponent(providedKey(request, url))}`,
      },
    });
  }
  return json(200, body, method);
}
