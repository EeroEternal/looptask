use axum::{
    Json, Router,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tower_http::trace::TraceLayer;

use crate::{
    celld,
    models::{LoopDefinition, Project},
};

pub fn create_router() -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/ping", get(ping))
        .route("/api/v1/runtime/celld", post(describe_celld_runtime))
        .route("/api/v1/loops/plan", post(plan_loop))
        .layer(TraceLayer::new_for_http())
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

async fn plan_loop(Json(request): Json<LoopPlanRequest>) -> Json<LoopPlanResponse> {
    let loop_def = request
        .project
        .loops
        .iter()
        .find(|candidate| candidate.name == request.loop_name)
        .cloned();

    let Some(loop_def) = loop_def else {
        return Json(LoopPlanResponse {
            accepted: false,
            reason: format!("loop '{}' not found", request.loop_name),
            loop_plan: None,
        });
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
pub struct LoopPlan {
    pub project: String,
    pub loop_def: LoopDefinition,
    pub agent_cell_id: String,
    pub celld: celld::CelldFoundation,
}

fn default_agent_key() -> String {
    "default".to_string()
}
