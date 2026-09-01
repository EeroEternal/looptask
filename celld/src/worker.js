export { AgentCell } from "./agent_cell.js";

function storageUri(env, key) {
  return `r2://${env.ARTIFACT_BUCKET}/${key}`;
}

function artifactKey(env, agentId, encodedPath) {
  let artifactPath;
  try {
    artifactPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  const prefix = (env.ARTIFACT_PREFIX || "").replace(/^\/+|\/+$/g, "");
  const agentParts = agentId.split("/");
  const pathParts = artifactPath.split("/");
  if (
    !prefix ||
    agentParts.some((part) => !part || part === "." || part === "..") ||
    pathParts.some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return [prefix, ...agentParts, "artifacts", ...pathParts].join("/");
}

async function artifactObject(request, env, agentId, encodedPath) {
  if (!env.ARTIFACTS || !env.ARTIFACT_BUCKET) {
    return Response.json(
      { error: "R2 artifact storage is not configured" },
      { status: 503 },
    );
  }

  const key = artifactKey(env, agentId, encodedPath);
  if (!key) {
    return Response.json({ error: "invalid artifact path" }, { status: 400 });
  }

  if (request.method === "PUT") {
    const contentType =
      request.headers.get("content-type") || "application/octet-stream";
    await env.ARTIFACTS.put(key, request.body, {
      httpMetadata: { contentType },
    });
    return Response.json({
      stored: true,
      key,
      storageUri: storageUri(env, key),
    });
  }

  const object = await env.ARTIFACTS.get(key);
  if (!object) {
    return Response.json({ error: "artifact not found" }, { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  headers.set("x-looptask-storage-uri", storageUri(env, key));
  if (request.method === "HEAD") {
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/agents\/([^/]+)(\/.*)?$/);
    if (!match) {
      return Response.json({
        service: "looptask-agent-runtime",
        status: "ok",
        model: "celld-durable-object",
      });
    }

    const agentId = decodeURIComponent(match[1]);
    const tail = match[2] || "/";
    const artifactMatch = tail.match(/^\/artifacts\/(.+)$/);
    if (
      artifactMatch &&
      ["GET", "HEAD", "PUT"].includes(request.method)
    ) {
      return artifactObject(request, env, agentId, artifactMatch[1]);
    }

    const id = env.AGENT_CELL.idFromName(agentId);
    const stub = env.AGENT_CELL.get(id);
    const headers = new Headers(request.headers);
    headers.set("x-looptask-agent-id", agentId);
    const forwarded = new Request(new URL(tail, request.url), {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect,
    });
    return stub.fetch(forwarded);
  },
};
