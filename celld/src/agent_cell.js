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
    if (request.method === "POST" && url.pathname === "/resident/cancel") {
      return this.cancelResident(request);
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
    const scheduled = [...this.sql.exec("SELECT COUNT(*) AS count FROM tasks WHERE status = 'scheduled'")][0].count;
    return Response.json({ inbox, tasks, artifacts, scheduled });
  }

  async enqueue(request) {
    const event = await request.json();
    const id = event.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const residentInterval = Number(event.body?.resident?.intervalSeconds);
    if (event.wakeAt && Number.isInteger(residentInterval) && residentInterval >= 60) {
      this.sql.exec(
        "INSERT INTO tasks (id, status, payload_json, due_alarm, updated_at) VALUES (?, 'scheduled', ?, ?, ?)",
        id,
        JSON.stringify({ source: event.source || "looptask", body: event.body || {} }),
        event.wakeAt,
        now,
      );
      await this.scheduleNextAlarm();
      return Response.json({ accepted: true, id });
    }
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

  async cancelResident(request) {
    const payload = await request.json();
    const loopName = String(payload.loop || "");
    if (!loopName) {
      return Response.json({ error: "loop is required" }, { status: 400 });
    }

    const scheduledTasks = [...this.sql.exec(
      "SELECT id, payload_json FROM tasks WHERE status = 'scheduled'",
    )];
    let cancelled = 0;
    for (const task of scheduledTasks) {
      try {
        const taskPayload = JSON.parse(task.payload_json);
        if (taskPayload.body?.loop === loopName) {
          this.sql.exec("DELETE FROM tasks WHERE id = ?", task.id);
          cancelled += 1;
        }
      } catch {
        // Invalid scheduled payloads are left for alarm() to surface as an event.
      }
    }
    await this.scheduleNextAlarm();
    return Response.json({ cancelled });
  }

  async alarm() {
    const now = new Date();
    const nowIso = now.toISOString();
    const dueTasks = [...this.sql.exec(
      "SELECT id, payload_json FROM tasks WHERE status = 'scheduled' AND due_alarm <= ? ORDER BY due_alarm ASC",
      nowIso,
    )];

    for (const task of dueTasks) {
      let payload = {};
      try {
        payload = JSON.parse(task.payload_json);
      } catch {
        payload = { source: "alarm", body: { reason: "invalid-scheduled-payload" } };
      }
      this.sql.exec(
        "INSERT INTO inbox (id, source, body_json, created_at) VALUES (?, ?, ?, ?)",
        crypto.randomUUID(),
        payload.source || "alarm",
        JSON.stringify(payload.body || {}),
        nowIso,
      );

      const interval = Number(payload.body?.resident?.intervalSeconds);
      if (Number.isInteger(interval) && interval >= 60) {
        const nextDue = new Date(now.getTime() + interval * 1000).toISOString();
        this.sql.exec(
          "UPDATE tasks SET due_alarm = ?, updated_at = ? WHERE id = ?",
          nextDue,
          nowIso,
          task.id,
        );
      } else {
        this.sql.exec(
          "UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?",
          nowIso,
          task.id,
        );
      }
    }

    if (dueTasks.length === 0) {
      this.sql.exec(
        "INSERT INTO inbox (id, source, body_json, created_at) VALUES (?, ?, ?, ?)",
        crypto.randomUUID(),
        "alarm",
        JSON.stringify({ reason: "scheduled-loop-wakeup" }),
        nowIso,
      );
    }
    await this.scheduleNextAlarm();
  }

  async scheduleNextAlarm() {
    const next = [...this.sql.exec(
      "SELECT due_alarm FROM tasks WHERE status = 'scheduled' ORDER BY due_alarm ASC LIMIT 1",
    )][0];
    if (next?.due_alarm) {
      await this.ctx.storage.setAlarm(new Date(next.due_alarm));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}

