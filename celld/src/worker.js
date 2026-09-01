export { AgentCell } from "./agent_cell.js";

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
