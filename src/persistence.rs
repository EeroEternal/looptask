use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{Value, json};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    Error, Result,
    models::{LoopDefinition, Project},
};

#[derive(Clone)]
pub struct ProjectStore {
    pool: PgPool,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub repository: Option<String>,
    pub default_branch: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: Uuid,
    pub project_name: String,
    pub loop_name: String,
    pub status: String,
    pub agent_cell_id: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub pr_number: Option<i32>,
    pub pr_url: Option<String>,
    pub confirmation_state: Option<String>,
    pub email_delivery_state: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub id: Uuid,
    pub event_type: String,
    pub payload_json: Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedProject {
    pub id: Uuid,
    pub config: Project,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct PreparedRun {
    pub id: Uuid,
    pub created: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct CompletionContext {
    pub run_id: Uuid,
    pub user_id: Uuid,
    pub owner_email: String,
    pub project_name: String,
    pub repository: Option<String>,
    pub default_branch: String,
    pub loop_name: String,
    pub goal: String,
    pub status: String,
    pub dispatch_id: Option<String>,
    pub callback_id: Option<String>,
    pub pr_number: Option<i32>,
    pub pr_url: Option<String>,
    pub confirmation_email_sent_at: Option<DateTime<Utc>>,
    pub completion_processing: bool,
    pub completion_processing_at: Option<DateTime<Utc>>,
    pub email_delivery_state: String,
}

#[derive(Debug, Clone)]
pub struct ClaimedCompletion {
    pub context: CompletionContext,
    pub acquired_processing: bool,
}

#[derive(Debug, FromRow)]
struct ProjectRecord {
    id: Uuid,
    config_json: Value,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl ProjectStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn save_project(&self, user_id: Uuid, project: &Project) -> Result<Uuid> {
        validate_project_name(project)?;
        let config_json = serde_json::to_value(project)
            .map_err(|error| Error::Internal(anyhow::anyhow!(error)))?;
        let mut tx = self.pool.begin().await?;
        let project_id = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO projects
                (id, user_id, name, repository, default_branch, config_json)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, name) DO UPDATE SET
                repository = EXCLUDED.repository,
                default_branch = EXCLUDED.default_branch,
                config_json = EXCLUDED.config_json,
                updated_at = NOW()
             RETURNING id",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(&project.name)
        .bind(&project.repository)
        .bind(&project.default_branch)
        .bind(&config_json)
        .fetch_one(&mut *tx)
        .await?;

        for loop_def in &project.loops {
            let definition_json = serde_json::to_value(loop_def)
                .map_err(|error| Error::Internal(anyhow::anyhow!(error)))?;
            sqlx::query(
                "INSERT INTO loop_definitions
                    (id, project_id, name, definition_json)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (project_id, name, version) DO UPDATE SET
                    definition_json = EXCLUDED.definition_json,
                    active = TRUE,
                    updated_at = NOW()",
            )
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(&loop_def.name)
            .bind(definition_json)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(project_id)
    }

    pub async fn list_projects(&self, user_id: Uuid) -> Result<Vec<ProjectSummary>> {
        Ok(sqlx::query_as::<_, ProjectSummary>(
            "SELECT id, name, repository, default_branch, updated_at
             FROM projects
             WHERE user_id = $1
             ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn get_project(&self, user_id: Uuid, project_id: Uuid) -> Result<SavedProject> {
        let record = sqlx::query_as::<_, ProjectRecord>(
            "SELECT id, config_json, created_at, updated_at
             FROM projects
             WHERE id = $1 AND user_id = $2",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound("project not found".to_string()))?;
        let config = serde_json::from_value(record.config_json)
            .map_err(|error| Error::Internal(anyhow::anyhow!(error)))?;
        Ok(SavedProject {
            id: record.id,
            config,
            created_at: record.created_at,
            updated_at: record.updated_at,
        })
    }

    pub async fn list_runs(&self, user_id: Uuid, limit: i64) -> Result<Vec<RunSummary>> {
        let limit = limit.clamp(1, 100);
        Ok(sqlx::query_as::<_, RunSummary>(
            "SELECT r.id, p.name AS project_name, r.loop_name, r.status,
                    r.agent_cell_id, r.started_at, r.ended_at, r.pr_number, r.pr_url,
                    r.confirmation_state, r.email_delivery_state
             FROM loop_runs r
             JOIN projects p ON p.id = r.project_id
             WHERE r.user_id = $1
             ORDER BY r.started_at DESC
             LIMIT $2",
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn list_run_events(&self, user_id: Uuid, run_id: Uuid) -> Result<Vec<RunEvent>> {
        Ok(sqlx::query_as::<_, RunEvent>(
            "SELECT e.id, e.event_type, e.payload_json, e.created_at
             FROM loop_events e
             JOIN loop_runs r ON r.id = e.run_id
             WHERE e.run_id = $1 AND r.user_id = $2
             ORDER BY e.created_at ASC",
        )
        .bind(run_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn prepare_run(
        &self,
        user_id: Uuid,
        project: &Project,
        loop_def: &LoopDefinition,
        agent_key: &str,
        agent_cell_id: &str,
        idempotency_key: &str,
    ) -> Result<PreparedRun> {
        let project_id = self.save_project(user_id, project).await?;
        let loop_definition_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT id
             FROM loop_definitions
             WHERE project_id = $1 AND name = $2 AND active = TRUE
             ORDER BY version DESC
             LIMIT 1",
        )
        .bind(project_id)
        .bind(&loop_def.name)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound("loop definition not found".to_string()))?;
        let request_json = json!({
            "project": project,
            "loopName": loop_def.name,
            "agentKey": agent_key,
        });
        let run_id = Uuid::new_v4();
        let inserted = sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO loop_runs
                (id, user_id, project_id, loop_definition_id, loop_name,
                 agent_key, agent_cell_id, status, idempotency_key, request_json)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9)
             ON CONFLICT (user_id, idempotency_key) DO NOTHING
             RETURNING id",
        )
        .bind(run_id)
        .bind(user_id)
        .bind(project_id)
        .bind(loop_definition_id)
        .bind(&loop_def.name)
        .bind(agent_key)
        .bind(agent_cell_id)
        .bind(idempotency_key)
        .bind(request_json)
        .fetch_optional(&self.pool)
        .await?;

        let Some(run_id) = inserted else {
            let existing_id = sqlx::query_scalar::<_, Uuid>(
                "SELECT id FROM loop_runs WHERE user_id = $1 AND idempotency_key = $2",
            )
            .bind(user_id)
            .bind(idempotency_key)
            .fetch_one(&self.pool)
            .await?;
            return Ok(PreparedRun {
                id: existing_id,
                created: false,
            });
        };

        self.append_event(run_id, "queued", json!({ "source": "looptask" }))
            .await?;
        Ok(PreparedRun {
            id: run_id,
            created: true,
        })
    }

    pub async fn mark_running(&self, run_id: Uuid, dispatch_id: &str) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs
             SET status = 'running', dispatch_id = $2, started_at = COALESCE(started_at, NOW())
             WHERE id = $1",
        )
        .bind(run_id)
        .bind(dispatch_id)
        .execute(&self.pool)
        .await?;
        self.append_event(run_id, "dispatched", json!({ "dispatchId": dispatch_id }))
            .await
    }

    pub async fn mark_failed(&self, run_id: Uuid, reason: &str) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs
             SET status = 'failed', ended_at = NOW(), failure_reason = $2, completion_processing = FALSE
             WHERE id = $1",
        )
        .bind(run_id)
        .bind(reason)
        .execute(&self.pool)
        .await?;
        self.append_event(run_id, "failed", json!({ "reason": reason }))
            .await
    }

    pub async fn completion_context(&self, run_id: Uuid) -> Result<CompletionContext> {
        sqlx::query_as::<_, CompletionContext>(
            "SELECT r.id AS run_id, r.user_id, u.email AS owner_email, p.name AS project_name,
                    p.repository, p.default_branch, r.loop_name,
                    COALESCE(ld.definition_json->>'goal', '') AS goal, r.status, r.dispatch_id,
                    r.callback_id, r.pr_number, r.pr_url, r.confirmation_email_sent_at,
                    r.completion_processing, r.completion_processing_at, r.email_delivery_state
             FROM loop_runs r JOIN users u ON u.id = r.user_id
             JOIN projects p ON p.id = r.project_id
             JOIN loop_definitions ld ON ld.id = r.loop_definition_id
             WHERE r.id = $1",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound("run not found".to_string()))
    }

    /// Records a callback ID before external work. A callback ID is globally
    /// unique, and may only ever be associated with its original run.
    pub async fn claim_completion_callback(
        &self,
        run_id: Uuid,
        callback_id: &str,
        dispatch_id: &str,
    ) -> Result<ClaimedCompletion> {
        let mut tx = self.pool.begin().await?;
        let context = sqlx::query_as::<_, CompletionContext>(
            "SELECT r.id AS run_id, r.user_id, u.email AS owner_email, p.name AS project_name,
                    p.repository, p.default_branch, r.loop_name,
                    COALESCE(ld.definition_json->>'goal', '') AS goal, r.status, r.dispatch_id,
                    r.callback_id, r.pr_number, r.pr_url, r.confirmation_email_sent_at,
                    r.completion_processing, r.completion_processing_at, r.email_delivery_state
             FROM loop_runs r JOIN users u ON u.id=r.user_id JOIN projects p ON p.id=r.project_id
             JOIN loop_definitions ld ON ld.id=r.loop_definition_id WHERE r.id=$1 FOR UPDATE",
        )
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| Error::NotFound("run not found".to_string()))?;
        let claimed_by = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM loop_runs WHERE callback_id=$1 AND id <> $2",
        )
        .bind(callback_id)
        .bind(run_id)
        .fetch_optional(&mut *tx)
        .await?;
        if claimed_by.is_some() {
            return Err(Error::Config(
                "callbackId is already associated with another run".to_string(),
            ));
        }
        if context.dispatch_id.as_deref() != Some(dispatch_id) {
            return Err(Error::Unauthorized(
                "callback dispatchId does not match this run".to_string(),
            ));
        }
        if let Some(existing) = &context.callback_id {
            if existing != callback_id {
                return Err(Error::Config(
                    "run was already completed by a different callbackId".to_string(),
                ));
            }
        } else {
            sqlx::query("UPDATE loop_runs SET callback_id=$2 WHERE id=$1")
                .bind(run_id)
                .bind(callback_id)
                .execute(&mut *tx)
                .await?;
        }
        let lease_expired = context
            .completion_processing_at
            .is_none_or(|claimed_at| claimed_at < Utc::now() - chrono::Duration::minutes(5));
        if context.completion_processing && !lease_expired {
            tx.commit().await?;
            return Ok(ClaimedCompletion {
                context,
                acquired_processing: false,
            });
        }
        sqlx::query(
            "UPDATE loop_runs SET completion_processing=TRUE, completion_processing_at=NOW() WHERE id=$1",
        )
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(ClaimedCompletion {
            context: self.completion_context(run_id).await?,
            acquired_processing: true,
        })
    }

    pub async fn persist_pr(
        &self,
        run_id: Uuid,
        number: i32,
        url: &str,
        branch: &str,
        sha: &str,
        summary: &str,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs SET status='needs-human', ended_at=NOW(), pr_number=$2, pr_url=$3,
             head_branch=$4, head_sha=$5, completion_summary=$6,
             confirmation_state=COALESCE(confirmation_state, 'pending')
             WHERE id=$1",
        )
        .bind(run_id)
        .bind(number)
        .bind(url)
        .bind(branch)
        .bind(sha)
        .bind(summary)
        .execute(&self.pool)
        .await?;
        self.append_event(
            run_id,
            "pr_created",
            json!({"prNumber":number,"prUrl":url,"headBranch":branch}),
        )
        .await?;
        self.append_event(
            run_id,
            "awaiting_merge_confirmation",
            json!({"prNumber":number}),
        )
        .await
    }

    pub async fn claim_confirmation_email(&self, run_id: Uuid) -> Result<bool> {
        Ok(sqlx::query(
            "UPDATE loop_runs SET email_delivery_state='claimed', email_delivery_claimed_at=NOW()
             WHERE id=$1 AND email_delivery_state='pending'",
        )
        .bind(run_id)
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }

    pub async fn mark_confirmation_email_sent(&self, run_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs SET email_delivery_state='sent', confirmation_email_sent_at=NOW(),
             completion_processing=FALSE WHERE id=$1 AND email_delivery_state='claimed'",
        )
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn release_confirmation_email_claim(&self, run_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs SET email_delivery_state='pending', email_delivery_claimed_at=NULL
             WHERE id=$1 AND email_delivery_state='claimed'",
        )
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        self.append_event(
            run_id,
            "confirmation_email_rejected",
            json!({"retryable":true}),
        )
        .await
    }

    pub async fn mark_confirmation_email_unknown(&self, run_id: Uuid) -> Result<()> {
        sqlx::query(
            "UPDATE loop_runs SET email_delivery_state='unknown'
             WHERE id=$1 AND email_delivery_state='claimed'",
        )
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        self.append_event(
            run_id,
            "confirmation_email_unknown",
            json!({"retryable":false}),
        )
        .await
    }

    pub async fn finish_completion_processing(&self, run_id: Uuid) -> Result<()> {
        sqlx::query("UPDATE loop_runs SET completion_processing=FALSE WHERE id=$1")
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn record_merge_confirmation(
        &self,
        user_id: Uuid,
        run_id: Uuid,
        decision: &str,
    ) -> Result<()> {
        let confirmation_state = match decision {
            "approve" => "approved",
            "reject" => "rejected",
            _ => {
                return Err(Error::Config(
                    "decision must be approve or reject".to_string(),
                ));
            }
        };
        let mut tx = self.pool.begin().await?;
        let status = sqlx::query_scalar::<_, String>(
            "SELECT status FROM loop_runs WHERE id=$1 AND user_id=$2 FOR UPDATE",
        )
        .bind(run_id)
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| Error::NotFound("run not found".to_string()))?;
        if status != "needs-human" {
            return Err(Error::Config(
                "run is not awaiting owner confirmation".to_string(),
            ));
        }
        let changed = sqlx::query("UPDATE loop_runs SET confirmation_state=$3, confirmation_decided_at=NOW() WHERE id=$1 AND user_id=$2 AND confirmation_state='pending'")
            .bind(run_id).bind(user_id).bind(confirmation_state).execute(&mut *tx).await?.rows_affected();
        if changed != 1 {
            return Err(Error::Config(
                "merge confirmation was already recorded".to_string(),
            ));
        }
        tx.commit().await?;
        self.append_event(
            run_id,
            "merge_confirmation_recorded",
            json!({"decision":decision,"mergePerformed":false}),
        )
        .await
    }

    async fn append_event(&self, run_id: Uuid, event_type: &str, payload: Value) -> Result<()> {
        sqlx::query(
            "INSERT INTO loop_events (id, run_id, event_type, payload_json)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4())
        .bind(run_id)
        .bind(event_type)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn validate_project_name(project: &Project) -> Result<()> {
    if project.name.trim().is_empty() {
        return Err(Error::Config("project.name is required".to_string()));
    }
    if project.name.len() > 120 {
        return Err(Error::Config("project.name is too long".to_string()));
    }
    Ok(())
}
