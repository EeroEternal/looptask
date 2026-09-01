use axum::{
    Json, Router,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::trace::TraceLayer;

use crate::{
    Result, celld,
    models::{LoopDefinition, Project},
};

pub fn create_router() -> Router {
    Router::new()
        .route("/", get(dashboard))
        .route("/health", get(health_check))
        .route("/api/v1/ping", get(ping))
        .route("/api/v1/runtime/celld", post(describe_celld_runtime))
        .route("/api/v1/loops/plan", post(plan_loop))
        .route("/api/v1/loops/dispatch", post(dispatch_loop))
        .route("/api/v1/celld/agents/state", post(celld_agent_state))
        .route("/api/v1/celld/agents/inbox", post(celld_agent_inbox))
        .route("/api/v1/celld/agents/artifacts", post(celld_agent_artifact))
        .layer(TraceLayer::new_for_http())
}

async fn dashboard() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../static/dashboard.html"))
}

async fn health_check() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "looptask",
        "runtime": "rust"
    }))
}

async fn ping() -> Json<Value> {
    Json(json!({ "message": "pong" }))
}

async fn describe_celld_runtime(Json(project): Json<Project>) -> Json<celld::CelldFoundation> {
    Json(celld::foundation(&project))
}

/// Resolves a loop by name and builds the plan describing which agent cell
/// it would dispatch to, without contacting celld.
fn build_loop_plan(
    project: &Project,
    loop_name: &str,
) -> std::result::Result<LoopDefinition, String> {
    project
        .loops
        .iter()
        .find(|candidate| candidate.name == loop_name)
        .cloned()
        .ok_or_else(|| format!("loop '{loop_name}' not found"))
}

async fn plan_loop(Json(request): Json<LoopPlanRequest>) -> Json<LoopPlanResponse> {
    let loop_def = match build_loop_plan(&request.project, &request.loop_name) {
        Ok(loop_def) => loop_def,
        Err(reason) => {
            return Json(LoopPlanResponse {
                accepted: false,
                reason,
                loop_plan: None,
            });
        }
    };

    let agent_cell_id = celld::agent_cell_id(&request.project, &loop_def, &request.agent_key);
    let foundation = celld::foundation(&request.project);
    Json(LoopPlanResponse {
        accepted: true,
        reason: "loop can be dispatched to a celld-backed agent cell".to_string(),
        loop_plan: Some(LoopPlan {
            project: request.project.name.clone(),
            loop_def,
            agent_cell_id,
            celld: foundation,
        }),
    })
}

/// Plans a loop and, on acceptance, actually dispatches it by enqueuing a
/// wakeup event into the target agent cell's celld inbox. This is the
/// dispatch step described in `README.md`'s outer-loop positioning.
async fn dispatch_loop(Json(request): Json<LoopPlanRequest>) -> Result<Json<LoopDispatchResponse>> {
    let loop_def = match build_loop_plan(&request.project, &request.loop_name) {
        Ok(loop_def) => loop_def,
        Err(reason) => {
            return Ok(Json(LoopDispatchResponse {
                accepted: false,
                reason,
                loop_plan: None,
                dispatch: None,
            }));
        }
    };

    let agent_cell_id = celld::agent_cell_id(&request.project, &loop_def, &request.agent_key);
    let event = celld::InboxEvent {
        id: None,
        source: "looptask-dispatch".to_string(),
        body: json!({
            "loop": loop_def.name,
            "kind": loop_def.kind,
            "goal": loop_def.goal,
            "mode": loop_def.mode,
        }),
        wake_at: None,
    };

    let client = celld::CelldClient::for_project(&request.project)?;
    let ack = client.enqueue_inbox(&agent_cell_id, &event).await?;

    let foundation = celld::foundation(&request.project);
    Ok(Json(LoopDispatchResponse {
        accepted: true,
        reason: "loop dispatched to celld-backed agent cell inbox".to_string(),
        loop_plan: Some(LoopPlan {
            project: request.project.name.clone(),
            loop_def,
            agent_cell_id,
            celld: foundation,
        }),
        dispatch: Some(ack),
    }))
}

async fn celld_agent_state(
    Json(request): Json<CelldAgentRequest>,
) -> Result<Json<celld::CellState>> {
    let client = celld::CelldClient::for_project(&request.project)?;
    let state = client.cell_state(&request.agent_cell_id).await?;
    Ok(Json(state))
}

async fn celld_agent_inbox(
    Json(request): Json<CelldInboxRequest>,
) -> Result<Json<celld::InboxAck>> {
    let client = celld::CelldClient::for_project(&request.project)?;
    let ack = client
        .enqueue_inbox(&request.agent_cell_id, &request.event)
        .await?;
    Ok(Json(ack))
}

async fn celld_agent_artifact(
    Json(request): Json<CelldArtifactRequest>,
) -> Result<Json<celld::ArtifactAck>> {
    let client = celld::CelldClient::for_project(&request.project)?;
    let ack = client
        .record_artifact(&request.agent_cell_id, &request.artifact)
        .await?;
    Ok(Json(ack))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopPlanRequest {
    pub project: Project,
    pub loop_name: String,
    #[serde(default = "default_agent_key")]
    pub agent_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopPlanResponse {
    pub accepted: bool,
    pub reason: String,
    pub loop_plan: Option<LoopPlan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopDispatchResponse {
    pub accepted: bool,
    pub reason: String,
    pub loop_plan: Option<LoopPlan>,
    pub dispatch: Option<celld::InboxAck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopPlan {
    pub project: String,
    pub loop_def: LoopDefinition,
    pub agent_cell_id: String,
    pub celld: celld::CelldFoundation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CelldAgentRequest {
    pub project: Project,
    pub agent_cell_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CelldInboxRequest {
    pub project: Project,
    pub agent_cell_id: String,
    pub event: celld::InboxEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CelldArtifactRequest {
    pub project: Project,
    pub agent_cell_id: String,
    pub artifact: celld::ArtifactRecord,
}

fn default_agent_key() -> String {
    "default".to_string()
}
