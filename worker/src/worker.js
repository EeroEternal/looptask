// looptask API — Cloudflare Worker with D1 (the only database).
// Frontend (Cloudflare Pages) calls this worker same-origin via functions/api proxy.
import { docsLifecycleTemplate, templates } from "./templates.js";

const SESSION_COOKIE = "looptask_session";
const SESSION_TTL_DAYS = 30;




const enc = new TextEncoder();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const configError = (message) => new ApiError(400, message);
const notFound = (message) => new ApiError(404, message);
const unauthorized = (message) => new ApiError(401, message);

const nowIso = () => new Date().toISOString();
const isoIn = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const uuid = () => crypto.randomUUID();

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function errorResponse(error) {
  if (error instanceof ApiError) {
    return json({ error: { message: error.message, code: error.status } }, error.status);
  }
  console.error("internal error", error);
  return json({ error: { message: "internal server error", code: 500 } }, 500);
}

// ---------------------------------------------------------------------------
// crypto helpers (HMAC-SHA256 via WebCrypto)
// ---------------------------------------------------------------------------

async function hmacKey(secret, usages) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

async function hmacHex(secret, data) {
  const key = await hmacKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacVerify(secret, data, signatureHex) {
  if (typeof signatureHex !== "string" || signatureHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(signatureHex)) {
    return false;
  }
  const bytes = new Uint8Array(signatureHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await hmacKey(secret, ["verify"]);
  return crypto.subtle.verify("HMAC", key, bytes, enc.encode(data));
}

function sessionSecret(env) {
  return env.SESSION_SECRET || "looptask-local-session";
}


function hashSessionToken(env, token) {
  return hmacHex(sessionSecret(env), `session:${token}`);
}


// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  const valid =
    email.length >= 5 &&
    email.length <= 254 &&
    at > 0 &&
    email.slice(at + 1).includes(".");
  if (!valid) throw configError("enter a valid email address");
  return email;
}

function normalizeDisplayName(value, fallback) {
  const name = String(value || "").trim();
  return name ? [...name].slice(0, 40).join("") : String(fallback || "operator");
}

function publicUser(row) {
  return { id: row.id, username: row.username, email: row.email, displayName: row.display_name, createdAt: row.created_at };
}

function sessionCookie(request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length) return rest.join("=");
  }
  return null;
}

async function sessionUser(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.email, u.display_name, u.created_at
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`,
  )
    .bind(await hashSessionToken(env, token), nowIso())
    .first();
  return row ? { user: publicUser(row) } : null;
}

// Username + password auth (PBKDF2-SHA256 via WebCrypto, no dependencies).
// ponytail: PBKDF2 also throttles guessing (every attempt costs real CPU);
// add Turnstile or account lockout if brute force ever becomes a concern.
const PBKDF2_ITERATIONS = 100_000; // Workers WebCrypto caps PBKDF2 at 100k iterations

async function derivePassword(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), hash: b64(await derivePassword(password, salt)) };
}

async function verifyPassword(password, saltB64, hashB64) {
  const expected = unb64(hashB64);
  const actual = await derivePassword(password, unb64(saltB64));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function normalizeUsername(value) {
  const username = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    throw configError("username must be 3-32 characters: letters, digits, _ or -");
  }
  return username;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 128) {
    throw configError("password must be at least 8 characters");
  }
  return password;
}

async function register(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = validatePassword(body.password);
  const displayName = normalizeDisplayName(body.displayName, username);
  const email = body.email ? normalizeEmail(body.email) : null;
  const { salt, hash } = await hashPassword(password);
  const createdAt = nowIso();
  const user = await env.DB.prepare(
    `INSERT INTO users (id, username, password_hash, password_salt, email, display_name, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (username) DO NOTHING
     RETURNING id, username, email, display_name, created_at`,
  )
    .bind(uuid(), username, hash, salt, email, displayName, createdAt)
    .first();
  if (!user) throw configError("username already taken - pick another one or log in");
  return startSession(env, user);
}

async function login(env, request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const user = await env.DB.prepare(
    "SELECT id, username, email, display_name, created_at, password_hash, password_salt FROM users WHERE username = ?1",
  )
    .bind(username)
    .first();
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    throw unauthorized("incorrect username or password");
  }
  return startSession(env, user);
}

async function startSession(env, user) {
  const sessionToken = uuid();
  const createdAt = nowIso();
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(uuid(), user.id, await hashSessionToken(env, sessionToken), isoIn(SESSION_TTL_DAYS * 24 * 3600), createdAt)
    .run();
  await env.DB.prepare("UPDATE users SET last_login_at = ?2, updated_at = ?2 WHERE id = ?1")
    .bind(user.id, createdAt)
    .run();
  return json(
    { authenticated: true, user: publicUser(user) },
    200,
    {
      "set-cookie":
        `${SESSION_COOKIE}=${sessionToken}; Max-Age=${SESSION_TTL_DAYS * 24 * 3600}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    },
  );
}

async function logout(env, request) {
  const token = sessionCookie(request);
  if (token) {
    await env.DB.prepare(
      "UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE token_hash = ?1",
    )
      .bind(await hashSessionToken(env, token), nowIso())
      .run();
  }
  return json(
    { loggedOut: true },
    200,
    { "set-cookie": `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax` },
  );
}

// ---------------------------------------------------------------------------
// email (Cloudflare Email Sending REST API)
// ---------------------------------------------------------------------------

function parseSenderAddress(value) {
  const sender = String(value || "").trim();
  if (!sender) throw configError("LOOPTASK_EMAIL_FROM must be a verified sender address");
  const open = sender.lastIndexOf("<");
  if (open > 0 && sender.endsWith(">")) {
    const name = sender.slice(0, open).trim().replace(/^"|"$/g, "");
    const address = normalizeEmail(sender.slice(open + 1, -1));
    if (!name) throw configError("LOOPTASK_EMAIL_FROM display name must not be empty");
    return { address, name };
  }
  return normalizeEmail(sender.replace(/^"|"$/g, ""));
}

async function sendMessage(env, recipient, subject, text, html) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const from = parseSenderAddress(env.LOOPTASK_EMAIL_FROM);
  if (!accountId || !apiToken) {
    throw configError("email service is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ to: recipient, from, subject, text, html }),
    },
  );
  const bodyText = await response.text();
  const cloudflareMessage = () => {
    try {
      return (JSON.parse(bodyText).errors || []).map((e) => e.message).join("; ") || "unknown error";
    } catch {
      return "unknown error";
    }
  };
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      const message = cloudflareMessage().includes("email.sending.error.email.invalid")
        ? "Cloudflare rejected the sender address or message - make sure LOOPTASK_EMAIL_FROM is on a verified Email Sending domain, then redeploy"
        : `Cloudflare rejected the email request（${response.status}）：${cloudflareMessage()}`;
      throw new ApiError(502, message);
    }
    throw new ApiError(502, `Cloudflare email delivery outcome unknown（${response.status}）：${cloudflareMessage()}`);
  }
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new ApiError(502, "Cloudflare returned invalid JSON");
  }
  if (payload.success !== true) {
    throw configError(`Cloudflare email send was not confirmed：${cloudflareMessage()}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendMergeRequest(env, recipient, project, task, prUrl) {
  const taskHtml = escapeHtml(task);
  const projectHtml = escapeHtml(project);
  const urlHtml = escapeHtml(prUrl);
  return sendMessage(
    env,
    recipient,
    `Confirm looptask task pull request: ${project}`,
    `Task "${task}" is done and a pull request was opened: ${prUrl}\nPlease approve or reject it in looptask. The decision is only recorded - nothing is merged automatically.`,
    `<p>Task "${taskHtml}" is done.</p><p><a href="${urlHtml}">View the pull request</a></p><p>Approve or reject it in looptask. The decision is only recorded - nothing is merged automatically.</p>`,
  );
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function validComponent(value) {
  return (
    value &&
    value !== "." &&
    value !== ".." &&
    value.length <= 100 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function validBranch(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    /^[A-Za-z0-9/._-]+$/.test(value)
  );
}

function parseRepository(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw configError("repository must be https://github.com/{owner}/{repo}");
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.host.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    String(value).trim().endsWith("/") ||
    segments.length !== 2
  ) {
    throw configError("repository must be https://github.com/{owner}/{repo}");
  }
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/, "");
  if (!validComponent(owner) || !validComponent(name)) {
    throw configError("repository owner and name contain invalid characters");
  }
  return { owner, name };
}

function githubApiBase(env) {
  let base;
  try {
    base = new URL(env.GITHUB_API_BASE || "https://api.github.com/");
  } catch {
    throw configError("invalid GitHub API base URL");
  }
  if (base.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(base.hostname)) {
    throw configError("GitHub API base must use HTTPS");
  }
  return base.href.endsWith("/") ? base.href : `${base.href}/`;
}

// GitHub App user authorization — no shared PAT. Each operator links their
// own GitHub account; tokens are stored AES-GCM encrypted (key derived from
// SESSION_SECRET) and refreshed via the App's refresh tokens.
function b64(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unb64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function secretKey(env) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(sessionSecret(env)));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(env, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await secretKey(env), enc.encode(plaintext));
  return `${b64(iv)}.${b64(ciphertext)}`;
}

async function decryptSecret(env, blob) {
  const [iv, ciphertext] = String(blob).split(".").map(unb64);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await secretKey(env), ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function githubOAuthExchange(env, params) {
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw configError("GitHub App GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not configured");
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "looptask-control-plane",
    },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.access_token) {
    throw configError(`GitHub authorization failed：${data.error_description || data.error || `HTTP ${response.status}`}`);
  }
  return data;
}

async function saveGithubConnection(env, userId, login, data) {
  await env.DB.prepare(
    `INSERT INTO github_connections (user_id, login, access_token, refresh_token, expires_at, scope, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (user_id) DO UPDATE SET
       login = excluded.login, access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, github_connections.refresh_token),
       expires_at = excluded.expires_at, scope = excluded.scope, updated_at = excluded.updated_at`,
  )
    .bind(
      userId,
      login,
      await encryptSecret(env, data.access_token),
      data.refresh_token ? await encryptSecret(env, data.refresh_token) : null,
      data.expires_in ? isoIn(Number(data.expires_in)) : null,
      data.scope || null,
      nowIso(),
    )
    .run();
}

async function userGithub(env, userId) {
  const row = await env.DB.prepare("SELECT * FROM github_connections WHERE user_id = ?1")
    .bind(userId)
    .first();
  if (!row) throw configError("this user has not connected GitHub yet - connect the GitHub App from the dashboard first");
  let token = await decryptSecret(env, row.access_token);
  if (row.expires_at && row.expires_at < nowIso()) {
    if (!row.refresh_token) throw configError("GitHub authorization expired - please reconnect");
    const refreshed = await githubOAuthExchange(env, {
      grant_type: "refresh_token",
      refresh_token: await decryptSecret(env, row.refresh_token),
    });
    await saveGithubConnection(env, userId, row.login, refreshed);
    token = refreshed.access_token;
  }
  return { token, base: githubApiBase(env) };
}

async function githubRequest(config, path, options = {}) {
  const response = await fetch(`${config.base}${path}`, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      authorization: `Bearer ${config.token}`,
      "user-agent": "looptask-control-plane",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(502, `GitHub API responded with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

// The GITHUB_TOKEN's own repository scope is the allowlist — GitHub rejects
// any repository the token cannot access, so no extra config is needed.
async function accessibleRepositories(config) {
  const repositories = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await githubRequest(
      config,
      `user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member`,
    );
    for (const repo of batch) {
      repositories.push({
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        defaultBranch: repo.default_branch,
        private: !!repo.private,
        canPush: !!repo.permissions?.push,
      });
    }
    if (batch.length < 100) break;
  }
  return repositories;
}

async function verifyBranchSha(config, repository, branch, expectedSha) {
  if (!validBranch(branch)) throw configError("invalid Git branch name");
  const branchData = await githubRequest(config, `repos/${repository.owner}/${repository.name}/branches/${branch}`);
  if (String(branchData.commit?.sha || "").toLowerCase() !== String(expectedSha).toLowerCase()) {
    throw configError("executor headSha does not match the GitHub branch head");
  }
}

async function createOrFindPr(config, repository, head, base, title, body) {
  if (!validBranch(head) || !validBranch(base)) throw configError("invalid Git branch name");
  const path = `repos/${repository.owner}/${repository.name}/pulls`;
  const query = `state=open&head=${encodeURIComponent(`${repository.owner}:${head}`)}&base=${encodeURIComponent(base)}`;
  const existing = await githubRequest(config, `${path}?${query}`);
  if (existing.length) return existing[0];
  return githubRequest(config, path, {
    method: "POST",
    body: JSON.stringify({ title, head, base, body }),
  });
}

// ---------------------------------------------------------------------------
// project / run persistence
// ---------------------------------------------------------------------------

function validateProjectName(project) {
  const name = String(project?.name || "");
  if (!name.trim()) throw configError("project.name is required");
  if (name.length > 120) throw configError("project.name is too long");
}

async function saveProject(env, userId, project) {
  validateProjectName(project);
  const configJson = JSON.stringify(project);
  const row = await env.DB.prepare(
    `INSERT INTO projects (id, user_id, name, repository, default_branch, config_json, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (user_id, name) DO UPDATE SET
       repository = excluded.repository,
       default_branch = excluded.default_branch,
       config_json = excluded.config_json,
       updated_at = excluded.updated_at
     RETURNING id`,
  )
    .bind(uuid(), userId, project.name, project.repository ?? null, project.defaultBranch || "main", configJson, nowIso())
    .first();
  const projectId = row.id;
  for (const loopDef of project.loops || []) {
    await env.DB.prepare(
      `INSERT INTO loop_definitions (id, project_id, name, definition_json, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT (project_id, name, version) DO UPDATE SET
         definition_json = excluded.definition_json, active = 1, updated_at = excluded.updated_at`,
    )
      .bind(uuid(), projectId, loopDef.name, JSON.stringify(loopDef), nowIso())
      .run();
  }
  return projectId;
}

async function appendEvent(env, runId, eventType, payload) {
  await env.DB.prepare(
    "INSERT INTO loop_events (id, run_id, event_type, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(uuid(), runId, eventType, JSON.stringify(payload), nowIso())
    .run();
}

async function prepareRun(env, userId, project, loopDef, agentKey, agentCellId, idempotencyKey) {
  const projectId = await saveProject(env, userId, project);
  const definition = await env.DB.prepare(
    `SELECT id FROM loop_definitions WHERE project_id = ?1 AND name = ?2 AND active = 1
     ORDER BY version DESC LIMIT 1`,
  )
    .bind(projectId, loopDef.name)
    .first();
  if (!definition) throw notFound("loop definition not found");

  const runId = uuid();
  const inserted = await env.DB.prepare(
    `INSERT INTO loop_runs
       (id, user_id, project_id, loop_definition_id, loop_name, agent_key, agent_cell_id,
        status, idempotency_key, request_json, started_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9, ?10)
     ON CONFLICT (user_id, idempotency_key) DO NOTHING
     RETURNING id`,
  )
    .bind(
      runId,
      userId,
      projectId,
      definition.id,
      loopDef.name,
      agentKey,
      agentCellId,
      idempotencyKey,
      JSON.stringify({ project, loopName: loopDef.name, agentKey }),
      nowIso(),
    )
    .first();

  if (!inserted) {
    const existing = await env.DB.prepare("SELECT id FROM loop_runs WHERE user_id = ?1 AND idempotency_key = ?2")
      .bind(userId, idempotencyKey)
      .first();
    return { id: existing.id, created: false };
  }
  await appendEvent(env, runId, "queued", { source: "looptask" });
  return { id: runId, created: true };
}

async function markRunning(env, runId, dispatchId) {
  await env.DB.prepare("UPDATE loop_runs SET status = 'running', dispatch_id = ?2 WHERE id = ?1")
    .bind(runId, dispatchId)
    .run();
  await appendEvent(env, runId, "dispatched", { dispatchId });
}

async function markFailed(env, runId, reason) {
  await env.DB.prepare(
    "UPDATE loop_runs SET status = 'failed', ended_at = ?2, failure_reason = ?3, completion_processing = 0 WHERE id = ?1",
  )
    .bind(runId, nowIso(), reason)
    .run();
  await appendEvent(env, runId, "failed", { reason });
}

async function completionContext(env, runId) {
  const row = await env.DB.prepare(
    `SELECT r.id AS run_id, r.user_id, u.email AS owner_email, p.name AS project_name,
            p.repository, p.default_branch, r.loop_name,
            COALESCE(json_extract(ld.definition_json, '$.goal'), '') AS goal,
            COALESCE(json_extract(ld.definition_json, '$.resultTarget'), 'pr') AS result_target, r.status, r.dispatch_id,
            r.callback_id, r.pr_number, r.pr_url, r.confirmation_email_sent_at,
            r.completion_processing, r.completion_processing_at, r.email_delivery_state
     FROM loop_runs r JOIN users u ON u.id = r.user_id
     JOIN projects p ON p.id = r.project_id
     JOIN loop_definitions ld ON ld.id = r.loop_definition_id
     WHERE r.id = ?1`,
  )
    .bind(runId)
    .first();
  if (!row) throw notFound("run not found");
  return row;
}

// ponytail: D1 has no interactive transactions; the completion claim uses
// conditional UPDATEs instead of SELECT ... FOR UPDATE (single D1 writer keeps
// this safe; upgrade to a real lease table if concurrent executors appear).
async function claimCompletionCallback(env, runId, callbackId, dispatchId) {
  const context = await completionContext(env, runId);
  const claimedBy = await env.DB.prepare("SELECT id FROM loop_runs WHERE callback_id = ?1 AND id <> ?2")
    .bind(callbackId, runId)
    .first();
  if (claimedBy) throw configError("callbackId is already associated with another run");
  if (context.dispatch_id !== dispatchId) {
    throw unauthorized("callback dispatchId does not match this run");
  }
  if (context.callback_id && context.callback_id !== callbackId) {
    throw configError("run was already completed by a different callbackId");
  }
  if (!context.callback_id) {
    await env.DB.prepare("UPDATE loop_runs SET callback_id = ?2 WHERE id = ?1 AND callback_id IS NULL")
      .bind(runId, callbackId)
      .run();
  }

  const leaseExpired =
    !context.completion_processing_at ||
    new Date(context.completion_processing_at).getTime() < Date.now() - 5 * 60 * 1000;
  if (context.completion_processing && !leaseExpired) {
    return { context, acquired: false };
  }
  await env.DB.prepare("UPDATE loop_runs SET completion_processing = 1, completion_processing_at = ?2 WHERE id = ?1")
    .bind(runId, nowIso())
    .run();
  return { context: await completionContext(env, runId), acquired: true };
}

async function persistPr(env, runId, number, url, branch, sha, summary) {
  await env.DB.prepare(
    `UPDATE loop_runs SET status = 'needs-human', ended_at = ?2, pr_number = ?3, pr_url = ?4,
     head_branch = ?5, head_sha = ?6, completion_summary = ?7,
     confirmation_state = COALESCE(confirmation_state, 'pending')
     WHERE id = ?1`,
  )
    .bind(runId, nowIso(), number, url, branch, sha, summary)
    .run();
  await appendEvent(env, runId, "pr_created", { prNumber: number, prUrl: url, headBranch: branch });
  await appendEvent(env, runId, "awaiting_merge_confirmation", { prNumber: number });
}

async function deliverConfirmationEmail(env, runId, context, prUrl) {
  if (!context.owner_email) {
    // No notification address on the account: record that mail is not
    // deliverable and finish; the PR still awaits confirmation in the UI.
    await env.DB.prepare(
      "UPDATE loop_runs SET email_delivery_state = 'unknown', completion_processing = 0 WHERE id = ?1",
    )
      .bind(runId)
      .run();
    await appendEvent(env, runId, "confirmation_email_skipped", { reason: "owner has no email" });
    return;
  }
  if (context.email_delivery_state === "sent") {
    await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
    return;
  }
  const claimed = await env.DB.prepare(
    `UPDATE loop_runs SET email_delivery_state = 'claimed', email_delivery_claimed_at = ?2
     WHERE id = ?1 AND email_delivery_state = 'pending'`,
  )
    .bind(runId, nowIso())
    .run();
  if (claimed.meta.changes !== 1) {
    await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
    throw configError("confirmation email delivery is unresolved; automatic retry is disabled to prevent duplicate mail");
  }
  try {
    await sendMergeRequest(env, context.owner_email, context.project_name, context.loop_name, prUrl);
    await env.DB.prepare(
      `UPDATE loop_runs SET email_delivery_state = 'sent', confirmation_email_sent_at = ?2, completion_processing = 0
       WHERE id = ?1 AND email_delivery_state = 'claimed'`,
    )
      .bind(runId, nowIso())
      .run();
  } catch (error) {
    if (error instanceof ApiError && error.status === 502) {
      await env.DB.prepare(
        "UPDATE loop_runs SET email_delivery_state = 'pending', email_delivery_claimed_at = NULL WHERE id = ?1 AND email_delivery_state = 'claimed'",
      )
        .bind(runId)
        .run();
      await appendEvent(env, runId, "confirmation_email_rejected", { retryable: true });
    } else {
      await env.DB.prepare("UPDATE loop_runs SET email_delivery_state = 'unknown' WHERE id = ?1 AND email_delivery_state = 'claimed'")
        .bind(runId)
        .run();
      await appendEvent(env, runId, "confirmation_email_unknown", { retryable: false });
    }
    await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// loop catalog
// ---------------------------------------------------------------------------

function buildLoopPlan(project, loopName) {
  const loopDef = (project?.loops || []).find((candidate) => candidate.name === loopName);
  if (!loopDef) return { reason: `loop '${loopName}' not found` };
  if (loopDef.trigger?.type === "resident") {
    const interval = loopDef.trigger.intervalSeconds;
    if (!(interval >= 60 && interval <= 31_536_000)) {
      return { reason: "resident interval must be between 60 seconds and 365 days" };
    }
  }
  return { loopDef };
}

function agentCellId(project, loopDef, agentKey) {
  return (loopDef.agent?.cellIdTemplate || "{project}/{loop}/{agent}")
    .replaceAll("{project}", project.name)
    .replaceAll("{loop}", loopDef.name)
    .replaceAll("{agent}", agentKey);
}

function validateLoop(project, loopName) {
  const selected =
    (loopName && (project?.loops || []).find((candidate) => candidate.name === loopName)) ||
    (project?.loops || [])[0] ||
    docsLifecycleTemplate.definition;
  const guardrails = [
    "never merge, never tag, never push main",
    "all changes must be made in an isolated worktree",
    "stop immediately when the budget is exceeded and open a budget-exceeded issue",
    ...(selected.safety?.forbiddenActions || []),
  ];
  return {
    accepted: !!(String(selected.name || "").trim() && (selected.steps || []).length),
    summary: String(selected.summary || "").trim() ? selected.summary : selected.goal,
    loop: selected,
    stages: (selected.steps || []).map((step) => ({
      id: step.id,
      title: step.title,
      purpose: step.purpose,
      safety: (step.allowedPaths || []).length ? `allowlist: ${step.allowedPaths.join("、")}` : "read-only or controlled operations",
    })),
    guardrails,
  };
}

// ---------------------------------------------------------------------------
// dispatch / executor callback
// ---------------------------------------------------------------------------

function publicCompletionUrl(request, runId) {
  // Derived from the request origin — no config needed.
  const url = new URL(request.url);
  url.pathname = `/api/v1/runs/${runId}/completion`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function validateCompletion(value) {
  const idOk = (v) =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(v);
  if (!idOk(value.callbackId) || !idOk(value.dispatchId)) {
    throw configError("invalid callbackId or dispatchId");
  }
  if (!validBranch(value.headBranch)) throw configError("invalid headBranch");
  const sha = String(value.headSha || "");
  if (!/^[0-9a-fA-F]+$/.test(sha) || ![40, 64].includes(sha.length)) {
    throw configError("headSha must be a 40 or 64 character hexadecimal SHA");
  }
  if (String(value.summary || "").length > 10_000) throw configError("summary is too long");
}

async function verifyExecutorSignature(env, request, bodyText) {
  const timestamp = request.headers.get("x-looptask-timestamp");
  const signature = request.headers.get("x-looptask-signature");
  if (!timestamp) throw unauthorized("missing executor timestamp");
  if (!signature) throw unauthorized("missing executor signature");
  const secret = env.LOOPTASK_EXECUTOR_SECRET;
  if (!secret) throw configError("LOOPTASK_EXECUTOR_SECRET is required");
  if (secret.length < 32) throw configError("LOOPTASK_EXECUTOR_SECRET must be at least 32 bytes");
  const timestampValue = Number(timestamp);
  if (!Number.isInteger(timestampValue)) throw unauthorized("invalid executor timestamp");
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (timestampValue < nowSeconds - 300 || timestampValue > nowSeconds + 300) {
    throw unauthorized("executor timestamp is outside the five minute window");
  }
  if (!(await hmacVerify(secret, `${timestamp}.${bodyText}`, signature))) {
    throw unauthorized("invalid executor signature");
  }
}

async function executorCompletion(env, request, runId) {
  const bodyText = await request.text();
  await verifyExecutorSignature(env, request, bodyText);
  let completion;
  try {
    completion = JSON.parse(bodyText);
  } catch {
    throw configError("invalid completion JSON");
  }
  validateCompletion(completion);

  const claim = await claimCompletionCallback(env, runId, completion.callbackId, completion.dispatchId);
  if (!claim.acquired) return json({ runId, status: "processing", reused: true });
  const context = claim.context;

  if (!completion.success) {
    if (context.status !== "running" && context.status !== "failed") {
      await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
      throw configError("run is no longer eligible for a failure completion");
    }
    if (context.status !== "failed") {
      await markFailed(env, runId, completion.summary);
    } else {
      await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
    }
    return json({ runId, status: "failed" });
  }

  if (context.pr_number && context.pr_url) {
    await deliverConfirmationEmail(env, runId, context, context.pr_url);
    return json({ runId, status: "needs-human", prNumber: context.pr_number, prUrl: context.pr_url, reused: true });
  }
  if (context.status !== "running") {
    await env.DB.prepare("UPDATE loop_runs SET completion_processing = 0 WHERE id = ?1").bind(runId).run();
    throw configError("run is no longer eligible for a successful completion");
  }
  if (completion.headBranch === context.default_branch) {
    // report-only: the executor produced no changes and has nothing to PR —
    // record the report and finish.
    await env.DB.prepare(
      "UPDATE loop_runs SET status = 'passed', ended_at = ?2, completion_summary = ?3, completion_processing = 0 WHERE id = ?1",
    )
      .bind(runId, nowIso(), completion.summary)
      .run();
    await appendEvent(env, runId, "completed", { report: true, headSha: completion.headSha });
    return json({ runId, status: "passed", reused: false });
  }
  const repositoryUrl = context.repository;
  if (!repositoryUrl) throw configError("run project has no repository");

  const config = await userGithub(env, context.user_id);
  const repository = parseRepository(repositoryUrl);

  if (context.result_target === "issue") {
    // Issue mode: the result is a report — file it as a GitHub issue and the
    // run is done. No PR, no merge confirmation.
    const issue = await githubRequest(config, `repos/${repository.owner}/${repository.name}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `looptask: ${context.loop_name}`,
        body: `**Goal:** ${context.goal}\n\n${completion.summary}`,
      }),
    });
    await env.DB.prepare(
      `UPDATE loop_runs SET status = 'passed', ended_at = ?2, pr_number = ?3, pr_url = ?4,
       head_branch = ?5, head_sha = ?6, completion_summary = ?7, completion_processing = 0 WHERE id = ?1`,
    )
      .bind(runId, nowIso(), issue.number, issue.html_url, completion.headBranch, completion.headSha, completion.summary)
      .run();
    await appendEvent(env, runId, "issue_created", { issueNumber: issue.number, issueUrl: issue.html_url });
    await appendEvent(env, runId, "completed", { resultTarget: "issue" });
    return json({ runId, status: "passed", issueNumber: issue.number, issueUrl: issue.html_url, reused: false });
  }

  await verifyBranchSha(config, repository, completion.headBranch, completion.headSha);
  const pr = await createOrFindPr(
    config,
    repository,
    completion.headBranch,
    context.default_branch,
    `looptask: ${context.loop_name}`,
    `Automated task: ${context.goal}\n\n${completion.summary}`,
  );
  await persistPr(env, runId, pr.number, pr.html_url, completion.headBranch, completion.headSha, completion.summary);
  // The completed callback is durable before mail is sent; normal retries
  // observe the persisted PR and never open a second pull request.
  await deliverConfirmationEmail(env, runId, context, pr.html_url);
  return json({ runId, status: "needs-human", prNumber: pr.number, prUrl: pr.html_url, reused: false });
}

async function dispatchLoop(env, user, request) {
  const body = await request.json().catch(() => ({}));
  const project = body.project || {};
  const { loopDef, reason } = buildLoopPlan(project, body.loopName);
  const agentKey = body.agentKey || "default";
  if (!loopDef) {
    return json({ accepted: false, reason, loopPlan: null, dispatch: null, runId: null, deduplicated: false });
  }

  const agentCell = agentCellId(project, loopDef, agentKey);
  const idempotencyKey = String(body.idempotencyKey || "").trim() || uuid();
  if (idempotencyKey.length > 200) throw configError("idempotencyKey is too long");

  const run = await prepareRun(env, user.id, project, loopDef, agentKey, agentCell, idempotencyKey);
  const loopPlan = { project: project.name, loopName: loopDef.name, agentCellId: agentCell };
  if (!run.created) {
    return json({
      accepted: true,
      reason: "loop already dispatched for this idempotency key",
      loopPlan,
      dispatch: { accepted: true, id: `run-${run.id}` },
      runId: run.id,
      deduplicated: true,
    });
  }

  const dispatchUrl = env.LOOPTASK_EXECUTOR_URL;
  const event = {
    id: `run-${run.id}`,
    source: "looptask-dispatch",
    sentAt: nowIso(),
    wakeAt: loopDef.trigger?.type === "resident" ? nowIso() : null,
    body: {
      loop: loopDef.name,
      kind: loopDef.kind,
      goal: loopDef.goal,
      mode: loopDef.mode,
      repository: project.repository ?? null,
      defaultBranch: project.defaultBranch || "main",
      runId: run.id,
      completionCallback: {
        url: publicCompletionUrl(request, run.id),
        method: "POST",
        authentication: {
          algorithm: "HMAC-SHA256",
          timestampHeader: "x-looptask-timestamp",
          signatureHeader: "x-looptask-signature",
          signedPayload: "timestamp + '.' + exact raw JSON request body",
          timestampWindowSeconds: 300,
        },
      },
      steps: loopDef.steps || [],
      verifiers: loopDef.verifiers || [],
      safety: loopDef.safety || {},
      resident: loopDef.trigger?.type === "resident" ? { intervalSeconds: loopDef.trigger.intervalSeconds } : null,
    },
  };

  // Pull model (recommended): the run stays queued in D1 and any sandbox
  // executor claims it via GET /api/v1/executions/next. Push model: set
  // LOOPTASK_EXECUTOR_URL and the payload above is POSTed to that endpoint.
  if (!dispatchUrl) {
    return json({
      accepted: true,
      reason: "run queued; waiting for an executor to claim it",
      loopPlan,
      dispatch: null,
      runId: run.id,
      deduplicated: false,
    });
  }
  let ack = { accepted: true, id: `run-${run.id}` };
  try {
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ApiError(502, `executor dispatch failed with ${response.status}`);
    ack = { ...(await response.json().catch(() => ({}))), accepted: true, id: `run-${run.id}` };
  } catch (error) {
    await markFailed(env, run.id, String(error.message || error));
    throw error;
  }
  await markRunning(env, run.id, ack.id);

  return json({
    accepted: true,
    reason: "loop dispatched to the external executor",
    loopPlan,
    dispatch: ack,
    runId: run.id,
    deduplicated: false,
  });
}

async function stopResident(env, request) {
  const body = await request.json().catch(() => ({}));
  const project = body.project || {};
  const { loopDef, reason } = buildLoopPlan(project, body.loopName);
  if (!loopDef) throw configError(reason);
  if (loopDef.trigger?.type !== "resident") {
    throw configError("the selected loop is not configured for resident execution");
  }
  const agentCell = agentCellId(project, loopDef, body.agentKey || "default");
  if (!env.LOOPTASK_EXECUTOR_URL) {
    return json({ accepted: true, agentCellId: agentCell, loopName: loopDef.name, notified: false });
  }
  const response = await fetch(env.LOOPTASK_EXECUTOR_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "looptask-resident-stop", agentCellId: agentCell, loop: loopDef.name }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error) => {
    throw new ApiError(502, `executor stop request failed: ${error.message || error}`);
  });
  if (!response.ok) throw new ApiError(502, `executor stop request failed with ${response.status}`);
  return json({ accepted: true, agentCellId: agentCell, loopName: loopDef.name, notified: true });
}

async function recordMergeConfirmation(env, user, request, runId) {
  const body = await request.json().catch(() => ({}));
  if (body.decision !== "approve" && body.decision !== "reject") {
    throw configError("decision must be approve or reject");
  }
  const confirmationState = body.decision === "approve" ? "approved" : "rejected";
  const run = await env.DB.prepare("SELECT status FROM loop_runs WHERE id = ?1 AND user_id = ?2")
    .bind(runId, user.id)
    .first();
  if (!run) throw notFound("run not found");
  if (run.status !== "needs-human") throw configError("run is not awaiting owner confirmation");
  const changed = await env.DB.prepare(
    `UPDATE loop_runs SET confirmation_state = ?3, confirmation_decided_at = ?4
     WHERE id = ?1 AND user_id = ?2 AND confirmation_state = 'pending'`,
  )
    .bind(runId, user.id, confirmationState, nowIso())
    .run();
  if (changed.meta.changes !== 1) throw configError("merge confirmation was already recorded");
  await appendEvent(env, runId, "merge_confirmation_recorded", { decision: body.decision, mergePerformed: false });
  return json({ runId, confirmationState, mergePerformed: false });
}

// ---------------------------------------------------------------------------
// executor claim (pull model)
// ---------------------------------------------------------------------------

function executorAuthorized(env, request) {
  const secret = env.LOOPTASK_EXECUTOR_SECRET;
  const header = request.headers.get("authorization") || "";
  return !!secret && secret.length >= 32 && header === `Bearer ${secret}`;
}

// Pure: the task payload an executor receives when claiming a run.
function executorTask(row, requestJson, loopDef, agentCell, dispatchId, callbackUrl) {
  return {
    runId: row.id,
    dispatchId,
    agentCellId: agentCell,
    repository: requestJson.project?.repository ?? null,
    defaultBranch: requestJson.project?.defaultBranch || "main",
    loop: loopDef,
    agentKey: row.agent_key,
    callback: {
      url: callbackUrl,
      method: "POST",
      authentication: {
        algorithm: "HMAC-SHA256",
        timestampHeader: "x-looptask-timestamp",
        signatureHeader: "x-looptask-signature",
        signedPayload: "timestamp + '.' + exact raw JSON request body",
        timestampWindowSeconds: 300,
        secretEnv: "LOOPTASK_EXECUTOR_SECRET",
      },
    },
  };
}

async function claimExecution(env, request) {
  if (!executorAuthorized(env, request)) throw unauthorized("invalid executor token");
  // ponytail: the conditional UPDATE keeps two concurrent pollers from both
  // winning the same run; fine for a small executor fleet.
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare(
      "SELECT id, agent_key, loop_name, request_json FROM loop_runs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1",
    ).first();
    if (!row) return new Response(null, { status: 204 });
    const dispatchId = `exec-${uuid()}`;
    const claimed = await env.DB.prepare(
      "UPDATE loop_runs SET status = 'running', dispatch_id = ?2 WHERE id = ?1 AND status = 'queued'",
    )
      .bind(row.id, dispatchId)
      .run();
    if (claimed.meta.changes !== 1) continue;
    const requestJson = JSON.parse(row.request_json);
    const loopDef = (requestJson.project?.loops || []).find((l) => l.name === row.loop_name) || {};
    const agentCell = agentCellId(requestJson.project || {}, loopDef, row.agent_key);
    await appendEvent(env, row.id, "dispatched", { dispatchId, source: "executions/claim" });
    return json(
      executorTask(row, requestJson, loopDef, agentCell, dispatchId, publicCompletionUrl(request, row.id)),
    );
  }
  return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// GitHub App user authorization (connect / callback / status)
// ---------------------------------------------------------------------------

function githubCallbackUrl(env, request) {
  // Pinned: GitHub requires the redirect_uri to exactly match the URL
  // registered on the GitHub App.
  const origin = (env.APP_ORIGIN || new URL(request.url).origin).replace(/\/+$/, "");
  return `${origin}/api/v1/github/callback`;
}

async function githubConnect(env, request) {
  const clientId = env.GITHUB_CLIENT_ID;
  if (!clientId) throw configError("GITHUB_CLIENT_ID is not configured (create a GitHub App first)");
  const state = await hmacHex(sessionSecret(env), `gh-state:${sessionCookie(request)}`);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", githubCallbackUrl(env, request));
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: url.href } });
}

async function githubCallback(env, request, auth) {
  const url = new URL(request.url);
  const expected = await hmacHex(sessionSecret(env), `gh-state:${sessionCookie(request)}`);
  if (!sessionCookie(request) || url.searchParams.get("state") !== expected) {
    throw unauthorized("GitHub callback state check failed - start the connection again from the dashboard");
  }
  const code = url.searchParams.get("code");
  if (!code) throw configError("GitHub callback is missing code");
  const data = await githubOAuthExchange(env, { code, redirect_uri: githubCallbackUrl(env, request) });
  const profile = await githubRequest({ token: data.access_token, base: githubApiBase(env) }, "user");
  await saveGithubConnection(env, auth.id, profile.login || "github-user", data);
  return Response.redirect(`${githubCallbackUrl(env, request).replace(/\/api\/v1\/github\/callback$/, "/")}`, 302);
}

async function githubStatus(env, auth) {
  const row = await env.DB.prepare("SELECT login, updated_at FROM github_connections WHERE user_id = ?1")
    .bind(auth.id)
    .first();
  return json({ connected: !!row, login: row?.login || null });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      return errorResponse(error);
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    return json({ status: "ok", service: "looptask", runtime: "cloudflare-worker" });
  }
  if (method === "GET" && path === "/api/v1/ping") {
    return json({ message: "pong" });
  }
  if (method === "POST" && path === "/api/v1/auth/register") {
    return register(env, request);
  }
  if (method === "POST" && path === "/api/v1/auth/login") {
    return login(env, request);
  }

  const user = await sessionUser(env, sessionCookie(request));

  if (method === "GET" && path === "/api/v1/auth/me") {
    return json({ authenticated: !!user, user: user ? user.user : null });
  }
  if (method === "POST" && path === "/api/v1/auth/logout") {
    return logout(env, request);
  }

  const completionMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/completion$/);
  if (method === "POST" && completionMatch) {
    return executorCompletion(env, request, completionMatch[1]);
  }
  if (method === "GET" && path === "/api/v1/executions/next") {
    return claimExecution(env, request);
  }

  if (!user) throw unauthorized("please log in first");
  const auth = user.user;

  if (method === "GET" && path === "/api/v1/loop-templates") {
    return json(templates());
  }
  if (method === "GET" && path === "/api/v1/projects") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, repository, default_branch, updated_at FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC",
    )
      .bind(auth.id)
      .all();
    return json(
      results.map((row) => ({
        id: row.id,
        name: row.name,
        repository: row.repository,
        defaultBranch: row.default_branch,
        updatedAt: row.updated_at,
      })),
    );
  }
  if (method === "POST" && path === "/api/v1/projects") {
    const project = await request.json().catch(() => ({}));
    const projectId = await saveProject(env, auth.id, project);
    return getProject(env, auth, projectId);
  }
  const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (method === "GET" && projectMatch) {
    return getProject(env, auth, projectMatch[1]);
  }
  if (method === "DELETE" && projectMatch) {
    await env.DB.prepare("DELETE FROM projects WHERE id = ?1 AND user_id = ?2")
      .bind(projectMatch[1], auth.id)
      .run();
    return json({ deleted: true });
  }

  if (method === "GET" && path === "/api/v1/runs") {
    const { results } = await env.DB.prepare(
      `SELECT r.id, p.name AS project_name, r.loop_name, r.status, r.agent_cell_id, r.started_at,
              r.ended_at, r.pr_number, r.pr_url, r.confirmation_state, r.email_delivery_state,
              r.dispatch_id
       FROM loop_runs r JOIN projects p ON p.id = r.project_id
       WHERE r.user_id = ?1 ORDER BY r.started_at DESC LIMIT 50`,
    )
      .bind(auth.id)
      .all();
    return json(
      results.map((row) => ({
        id: row.id,
        projectName: row.project_name,
        loopName: row.loop_name,
        status: row.status,
        agentCellId: row.agent_cell_id,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        prNumber: row.pr_number,
        prUrl: row.pr_url,
        confirmationState: row.confirmation_state,
        emailDeliveryState: row.email_delivery_state,
      })),
    );
  }
  const eventsMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const { results } = await env.DB.prepare(
      `SELECT e.id, e.event_type, e.payload_json, e.created_at FROM loop_events e
       JOIN loop_runs r ON r.id = e.run_id
       WHERE e.run_id = ?1 AND r.user_id = ?2 ORDER BY e.created_at ASC`,
    )
      .bind(eventsMatch[1], auth.id)
      .all();
    return json(
      results.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        payloadJson: JSON.parse(row.payload_json),
        createdAt: row.created_at,
      })),
    );
  }
  const confirmMatch = path.match(/^\/api\/v1\/runs\/([^/]+)\/merge-confirmation$/);
  if (method === "POST" && confirmMatch) {
    return recordMergeConfirmation(env, auth, request, confirmMatch[1]);
  }

  if (method === "GET" && path === "/api/v1/github/status") {
    return githubStatus(env, auth);
  }
  if (method === "GET" && path === "/api/v1/github/connect") {
    return githubConnect(env, request);
  }
  if (method === "GET" && path === "/api/v1/github/callback") {
    return githubCallback(env, request, auth);
  }
  if (method === "GET" && path === "/api/v1/github/repositories") {
    return json(await accessibleRepositories(await userGithub(env, auth.id)));
  }
  if (method === "POST" && path === "/api/v1/loops/validate") {
    const body = await request.json().catch(() => ({}));
    await saveProject(env, auth.id, body.project || {});
    return json(validateLoop(body.project, body.loopName));
  }
  if (method === "POST" && path === "/api/v1/loops/dispatch") {
    return dispatchLoop(env, auth, request);
  }
  if (method === "POST" && path === "/api/v1/loops/resident/stop") {
    return stopResident(env, request);
  }

  return json({ error: { message: "not found", code: 404 } }, 404);
}

async function getProject(env, auth, projectId) {
  const row = await env.DB.prepare(
    "SELECT id, config_json, created_at, updated_at FROM projects WHERE id = ?1 AND user_id = ?2",
  )
    .bind(projectId, auth.id)
    .first();
  if (!row) throw notFound("project not found");
  return json({
    id: row.id,
    config: JSON.parse(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// exported for tests only
export { encryptSecret, decryptSecret, hashPassword, verifyPassword, validBranch, validComponent, parseRepository, validateCompletion, hmacVerify, hmacHex, parseSenderAddress, validateLoop, buildLoopPlan, agentCellId, executorTask };
