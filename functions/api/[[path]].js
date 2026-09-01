export async function onRequest(context) {
  const configuredOrigin = context.env.LOOPTASK_API_ORIGIN;
  if (!configuredOrigin) {
    return Response.json(
      { error: "LOOPTASK_API_ORIGIN is not configured" },
      { status: 500 },
    );
  }

  let origin;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    return Response.json(
      { error: "LOOPTASK_API_ORIGIN must be an absolute URL" },
      { status: 500 },
    );
  }

  const requestUrl = new URL(context.request.url);
  origin.pathname = requestUrl.pathname;
  origin.search = requestUrl.search;

  const headers = new Headers(context.request.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", requestUrl.host);

  const upstreamRequest = new Request(origin, {
    method: context.request.method,
    headers,
    body: ["GET", "HEAD"].includes(context.request.method)
      ? undefined
      : context.request.body,
    redirect: "manual",
  });

  return fetch(upstreamRequest);
}