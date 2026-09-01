use axum::{
    Json, Router,
    extract::State,
    http::{
        HeaderMap, HeaderValue, Request,
        header::HeaderName,
        header::{COOKIE, SET_COOKIE},
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower_http::trace::TraceLayer;

use crate::{
    Error, Result,
    auth::{AuthState, CodeRequest, CodeResponse, CodeVerification, SessionResponse},
    celld,
    loop_catalog::{LoopValidationRequest, LoopValidationResponse},
    models::{LoopDefinition, Project},
};

#[derive(Clone, Default)]
pub struct AppState {
    pub auth: AuthState,
}

impl AppState {
    pub fn from_database(pool: PgPool) -> Self {
        Self {
            auth: AuthState::from_pool(pool),
        }
    }
}

pub fn create_router() -> Router {
    create_router_with_state(AppState::default())
}

pub fn create_router_with_database(pool: PgPool) -> Router {
    create_router_with_state(AppState::from_database(pool))
}

#[doc(hidden)]
pub async fn create_test_router() -> (Router, String) {
    let state = AppState::default();
    let session = state.auth.create_test_session().await;
    (create_router_with_state(state), session)
}

pub fn create_router_with_state(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/v1/loop-templates", get(loop_templates))
        .route("/api/v1/loops/validate", post(validate_loop))
        .route("/api/v1/runtime/celld", post(describe_celld_runtime))
        .route("/api/v1/loops/plan", post(plan_loop))
        .route("/api/v1/loops/dispatch", post(dispatch_loop))
        .route("/api/v1/celld/agents/state", post(celld_agent_state))
        .route("/api/v1/celld/agents/inbox", post(celld_agent_inbox))
        .route("/api/v1/celld/agents/artifacts", post(celld_agent_artifact))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_authenticated_user,
        ));

    Router::new()
        .route("/", get(dashboard))
        .route("/health", get(health_check))
        .route("/api/v1/ping", get(ping))
        .route("/api/v1/auth/request-code", post(request_auth_code))
        .route("/api/v1/auth/verify-code", post(verify_auth_code))
        .route("/api/v1/auth/me", get(auth_me))
        .route("/api/v1/auth/logout", post(logout))
        .merge(protected)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
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

async fn request_auth_code(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(request): Json<CodeRequest>,
) -> Result<Json<CodeResponse>> {
    let request_ip = request_ip(&headers);
    Ok(Json(
        state
            .auth
            .request_code(&request, request_ip.as_deref())
            .await?,
    ))
}

async fn verify_auth_code(
    State(state): State<AppState>,
    Json(request): Json<CodeVerification>,
) -> Result<(HeaderMap, Json<SessionResponse>)> {
    let (user, session_id) = state.auth.verify_code(&request).await?;
    let mut headers = HeaderMap::new();
    let cookie = format!(
        "looptask_session={session_id}; Max-Age={}; Path=/; HttpOnly; Secure; SameSite=Lax",
        30 * 24 * 60 * 60
    );
    headers.insert(
        SET_COOKIE,
        HeaderValue::from_str(&cookie)
            .map_err(|error| crate::Error::Internal(anyhow::anyhow!(error)))?,
    );
    Ok((
        headers,
        Json(SessionResponse {
            authenticated: true,
            user: Some(user),
        }),
    ))
}

async fn auth_me(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Json<SessionResponse>> {
    let user = state
        .auth
        .session_user(session_cookie(&headers).as_deref())
        .await?
        .map(|authenticated| authenticated.user);
    Ok(Json(SessionResponse {
        authenticated: user.is_some(),
        user,
    }))
}

async fn logout(
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<(HeaderMap, Json<Value>)> {
    state
        .auth
        .remove_session(session_cookie(&headers).as_deref())
        .await?;
    let mut response = HeaderMap::new();
    response.insert(
        SET_COOKIE,
        HeaderValue::from_static(
            "looptask_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
        ),
    );
    Ok((response, Json(json!({ "loggedOut": true }))))
}

async fn require_authenticated_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    match state
        .auth
        .session_user(session_cookie(&headers).as_deref())
        .await
    {
        Ok(Some(_)) => next.run(request).await,
        Ok(None) => Error::Unauthorized("请先登录后再执行此操作".to_string()).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn loop_templates() -> Json<Vec<crate::loop_catalog::LoopTemplate>> {
    Json(crate::loop_catalog::templates())
}

async fn validate_loop(Json(request): Json<LoopValidationRequest>) -> Json<LoopValidationResponse> {
    Json(crate::loop_catalog::validate(
        &request.project,
        request.loop_name.as_deref(),
    ))
}

fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies.split(';').find_map(|cookie| {
                let (name, value) = cookie.trim().split_once('=')?;
                (name == "looptask_session" && !value.is_empty()).then(|| value.to_string())
            })
        })
}

fn request_ip(headers: &HeaderMap) -> Option<String> {
    let cloudflare_ip = HeaderName::from_static("cf-connecting-ip");
    headers
        .get(&cloudflare_ip)
        .or_else(|| headers.get("x-forwarded-for"))
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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
