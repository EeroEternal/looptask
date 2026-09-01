export class AgentCell {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS inbox (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        body_json TEXT NOT NULL,
        acked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        due_alarm TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_summary (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        storage_uri TEXT NOT NULL,
        sha256 TEXT,
        bytes INTEGER NOT NULL,
        preview TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/state") {
      return this.state();
    }
    if (request.method === "POST" && url.pathname === "/inbox") {
      return this.enqueue(request);
    }
    if (request.method === "POST" && url.pathname === "/artifacts") {
      return this.recordArtifact(request);
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  state() {
    const inbox = [...this.sql.exec("SELECT COUNT(*) AS count FROM inbox WHERE acked = 0")][0].count;
    const tasks = [...this.sql.exec("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'")][0].count;
    const artifacts = [...this.sql.exec("SELECT COUNT(*) AS count FROM artifacts")][0].count;
    return Response.json({ inbox, tasks, artifacts });
  }

  async enqueue(request) {
    const event = await request.json();
    const id = event.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.sql.exec(
      "INSERT INTO inbox (id, source, body_json, created_at) VALUES (?, ?, ?, ?)",
      id,
      event.source || "looptask",
      JSON.stringify(event.body || {}),
      now,
    );
    if (event.wakeAt) {
      await this.ctx.storage.setAlarm(new Date(event.wakeAt));
    }
    return Response.json({ accepted: true, id });
  }

  async recordArtifact(request) {
    const artifact = await request.json();
    const id = artifact.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.sql.exec(
      "INSERT INTO artifacts (id, kind, storage_uri, sha256, bytes, preview, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      artifact.kind || "unknown",
      artifact.storageUri,
      artifact.sha256 || null,
      artifact.bytes || 0,
      artifact.preview || null,
      now,
    );
    return Response.json({ recorded: true, id });
  }

  async alarm() {
    this.sql.exec(
      "INSERT INTO inbox (id, source, body_json, created_at) VALUES (?, ?, ?, ?)",
      crypto.randomUUID(),
      "alarm",
      JSON.stringify({ reason: "scheduled-loop-wakeup" }),
      new Date().toISOString(),
    );
  }
}

