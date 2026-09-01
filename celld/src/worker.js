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
    const forwarded = new Request(new URL(tail, request.url), request);
    forwarded.headers.set("x-looptask-agent-id", agentId);
    return stub.fetch(forwarded);
  },
};

