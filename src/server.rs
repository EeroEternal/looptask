use axum::{
    Json, Router,
    body::Bytes,
    extract::{Extension, Path, State},
    http::{
        HeaderMap, HeaderValue, Request, StatusCode,
        header::HeaderName,
        header::{COOKIE, SET_COOKIE},
    },
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::PgPool;
use std::{env, path::Path as FilePath};
use tower_http::trace::TraceLayer;

use crate::{
    Error, Result,
    auth::{
        AuthState, AuthenticatedUser, CodeRequest, CodeResponse, CodeVerification, EmailSender,
        SessionResponse,
    },
    celld,
    loop_catalog::{LoopValidationRequest, LoopValidationResponse},
    models::{LoopDefinition, Project},
    persistence::{ProjectStore, RunEvent, RunSummary, SavedProject},
};

#[derive(Clone, Default)]
pub struct AppState {
    pub auth: AuthState,
    pub projects: Option<ProjectStore>,
}

impl AppState {
    pub fn from_database(pool: PgPool) -> Self {
        Self {
            auth: AuthState::from_pool(pool.clone()),
            projects: Some(ProjectStore::new(pool)),
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

#[doc(hidden)]
pub fn create_test_auth_router() -> (Router, AuthState) {
    let state = AppState::default();
    let auth = state.auth.clone();
    (create_router_with_state(state), auth)
}

pub fn create_router_with_state(state: AppState) -> Router {
    let protected = Router::new()
        .route("/api/v1/projects", get(list_projects).post(save_project))
        .route("/api/v1/projects/{project_id}", get(get_project))
        .route("/api/v1/runs", get(list_runs))
        .route("/api/v1/runs/{run_id}/events", get(list_run_events))
        .route(
            "/api/v1/runs/{run_id}/merge-confirmation",
            post(record_merge_confirmation),
        )
        .route("/api/v1/github/repositories", get(list_github_repositories))
        .route("/api/v1/loop-templates", get(loop_templates))
        .route("/api/v1/loops/validate", post(validate_loop))
        .route("/api/v1/runtime/celld", post(describe_celld_runtime))
        .route("/api/v1/loops/plan", post(plan_loop))
        .route("/api/v1/loops/dispatch", post(dispatch_loop))
        .route("/api/v1/loops/resident/stop", post(stop_resident))
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
        .route(
            "/api/v1/runs/{run_id}/completion",
            post(executor_completion),
        )
        .merge(protected)
        .route("/{*path}", get(static_asset))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn dashboard() -> std::result::Result<Html<String>, StatusCode> {
    tokio::fs::read_to_string("web/out/index.html")
        .await
        .map(Html)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

async fn static_asset(Path(path): Path<String>) -> Response {
    if path.split('/').any(|segment| segment == "..") {
        return StatusCode::NOT_FOUND.into_response();
    }

    let relative_path = if path.ends_with('/') {
        format!("{path}index.html")
    } else {
        path
    };
    let file_path = FilePath::new("web/out").join(&relative_path);
    let Ok(contents) = tokio::fs::read(&file_path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    (
        [(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static(content_type(&file_path)),
        )],
        contents,
    )
        .into_response()
}

fn content_type(path: &FilePath) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("woff") | Some("woff2") => "font/woff2",
        Some("html") => "text/html; charset=utf-8",
        _ => "application/octet-stream",
    }
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
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    match state
        .auth
        .session_user(session_cookie(&headers).as_deref())
        .await
    {
        Ok(Some(authenticated)) => {
            request.extensions_mut().insert(authenticated);
            next.run(request).await
        }
        Ok(None) => Error::Unauthorized("请先登录后再执行此操作".to_string()).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn loop_templates() -> Json<Vec<crate::loop_catalog::LoopTemplate>> {
    Json(crate::loop_catalog::templates())
}

async fn validate_loop(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
    Json(request): Json<LoopValidationRequest>,
) -> Result<Json<LoopValidationResponse>> {
    let validation = crate::loop_catalog::validate(&request.project, request.loop_name.as_deref());
    if let Some(store) = &state.projects {
        store
            .save_project(authenticated.user.id, &request.project)
            .await?;
    }
    Ok(Json(validation))
}

async fn save_project(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
    Json(project): Json<Project>,
) -> Result<Json<SavedProject>> {
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("project persistence is unavailable")))?;
    let project_id = store.save_project(authenticated.user.id, &project).await?;
    Ok(Json(
        store.get_project(authenticated.user.id, project_id).await?,
    ))
}

async fn list_projects(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<crate::persistence::ProjectSummary>>> {
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("project persistence is unavailable")))?;
    Ok(Json(store.list_projects(authenticated.user.id).await?))
}

async fn get_project(
    Path(project_id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
) -> Result<Json<SavedProject>> {
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("project persistence is unavailable")))?;
    Ok(Json(
        store.get_project(authenticated.user.id, project_id).await?,
    ))
}

async fn list_runs(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<RunSummary>>> {
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("run persistence is unavailable")))?;
    Ok(Json(store.list_runs(authenticated.user.id, 50).await?))
}

async fn list_github_repositories(
    Extension(_authenticated): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<crate::github::GitHubRepository>>> {
    Ok(Json(
        crate::github::GitHubClient::from_env()?
            .accessible_repositories()
            .await?,
    ))
}

async fn list_run_events(
    Path(run_id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<RunEvent>>> {
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("run persistence is unavailable")))?;
    Ok(Json(
        store.list_run_events(authenticated.user.id, run_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutorCompletion {
    callback_id: String,
    dispatch_id: String,
    success: bool,
    head_branch: String,
    head_sha: String,
    summary: String,
}

#[derive(Debug, Deserialize)]
struct MergeConfirmationRequest {
    decision: String,
}

async fn executor_completion(
    Path(run_id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>> {
    verify_executor_signature(&headers, &body)?;
    let completion: ExecutorCompletion = serde_json::from_slice(&body)
        .map_err(|_| Error::Config("invalid completion JSON".to_string()))?;
    validate_completion(&completion)?;
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("project persistence is unavailable")))?;
    let claim = store
        .claim_completion_callback(run_id, &completion.callback_id, &completion.dispatch_id)
        .await?;
    if !claim.acquired_processing {
        return Ok(Json(
            json!({"runId":run_id,"status":"processing","reused":true}),
        ));
    }
    let context = claim.context;
    if !completion.success {
        if context.status != "running" && context.status != "failed" {
            store.finish_completion_processing(run_id).await?;
            return Err(Error::Config(
                "run is no longer eligible for a failure completion".to_string(),
            ));
        }
        if context.status != "failed" {
            store.mark_failed(run_id, &completion.summary).await?;
        } else {
            store.finish_completion_processing(run_id).await?;
        }
        return Ok(Json(json!({"runId": run_id, "status": "failed"})));
    }
    if let (Some(number), Some(url)) = (context.pr_number, context.pr_url.clone()) {
        deliver_confirmation_email(store, run_id, &context, &url).await?;
        return Ok(Json(
            json!({"runId":run_id,"status":"needs-human","prNumber":number,"prUrl":url,"reused":true}),
        ));
    }
    if context.status != "running" {
        store.finish_completion_processing(run_id).await?;
        return Err(Error::Config(
            "run is no longer eligible for a successful completion".to_string(),
        ));
    }
    let repository = context
        .repository
        .as_deref()
        .ok_or_else(|| Error::Config("run project has no repository".to_string()))?;
    let repo = crate::github::parse_repository(repository)?;
    let github = crate::github::GitHubClient::from_env()?;
    github
        .verify_branch_sha(&repo, &completion.head_branch, &completion.head_sha)
        .await?;
    let pr = github
        .create_or_find_pr(
            &repo,
            &completion.head_branch,
            &context.default_branch,
            &format!("looptask: {}", context.loop_name),
            &format!("Automated task: {}\n\n{}", context.goal, completion.summary),
        )
        .await?;
    store
        .persist_pr(
            run_id,
            pr.number,
            &pr.html_url,
            &completion.head_branch,
            &completion.head_sha,
            &completion.summary,
        )
        .await?;
    // The completed callback is durable before mail is sent; normal retries
    // observe the persisted PR and never open a second pull request.
    deliver_confirmation_email(store, run_id, &context, &pr.html_url).await?;
    Ok(Json(
        json!({"runId":run_id,"status":"needs-human","prNumber":pr.number,"prUrl":pr.html_url,"reused":false}),
    ))
}

async fn deliver_confirmation_email(
    store: &ProjectStore,
    run_id: uuid::Uuid,
    context: &crate::persistence::CompletionContext,
    pr_url: &str,
) -> Result<()> {
    if context.email_delivery_state == "sent" {
        store.finish_completion_processing(run_id).await?;
        return Ok(());
    }
    if !store.claim_confirmation_email(run_id).await? {
        store.finish_completion_processing(run_id).await?;
        return Err(Error::Config(
            "confirmation email delivery is unresolved; automatic retry is disabled to prevent duplicate mail"
                .to_string(),
        ));
    }
    let delivery = EmailSender::from_env()?
        .send_merge_request(
            &context.owner_email,
            &context.project_name,
            &context.loop_name,
            pr_url,
        )
        .await;
    match delivery {
        Ok(()) => store.mark_confirmation_email_sent(run_id).await,
        Err(error) => {
            if matches!(&error, Error::EmailRejected(_)) {
                store.release_confirmation_email_claim(run_id).await?;
            } else {
                store.mark_confirmation_email_unknown(run_id).await?;
            }
            store.finish_completion_processing(run_id).await?;
            Err(error)
        }
    }
}

async fn record_merge_confirmation(
    Path(run_id): Path<uuid::Uuid>,
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
    Json(request): Json<MergeConfirmationRequest>,
) -> Result<Json<Value>> {
    if request.decision != "approve" && request.decision != "reject" {
        return Err(Error::Config(
            "decision must be approve or reject".to_string(),
        ));
    }
    let store = state
        .projects
        .as_ref()
        .ok_or_else(|| Error::Internal(anyhow::anyhow!("project persistence is unavailable")))?;
    store
        .record_merge_confirmation(authenticated.user.id, run_id, &request.decision)
        .await?;
    Ok(Json(
        json!({"runId":run_id,"confirmationState": if request.decision == "approve" {"approved"} else {"rejected"}, "mergePerformed":false}),
    ))
}

type HmacSha256 = Hmac<Sha256>;
fn verify_executor_signature(headers: &HeaderMap, body: &[u8]) -> Result<()> {
    let timestamp = headers
        .get("x-looptask-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Error::Unauthorized("missing executor timestamp".to_string()))?;
    let signature = headers
        .get("x-looptask-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| Error::Unauthorized("missing executor signature".to_string()))?;
    let secret = env::var("LOOPTASK_EXECUTOR_SECRET")
        .map_err(|_| Error::Config("LOOPTASK_EXECUTOR_SECRET is required".to_string()))?;
    if secret.len() < 32 {
        return Err(Error::Config(
            "LOOPTASK_EXECUTOR_SECRET must be at least 32 bytes".to_string(),
        ));
    }
    if secret.len() < 32 {
        return Err(Error::Config(
            "LOOPTASK_EXECUTOR_SECRET must contain at least 32 bytes".to_string(),
        ));
    }
    verify_executor_signature_values(timestamp, signature, body, &secret, Utc::now().timestamp())
}

fn verify_executor_signature_values(
    timestamp: &str,
    signature: &str,
    body: &[u8],
    secret: &str,
    now: i64,
) -> Result<()> {
    let timestamp_value: i64 = timestamp
        .parse()
        .map_err(|_| Error::Unauthorized("invalid executor timestamp".to_string()))?;
    if timestamp_value < now.saturating_sub(300) || timestamp_value > now.saturating_add(300) {
        return Err(Error::Unauthorized(
            "executor timestamp is outside the five minute window".to_string(),
        ));
    }
    let supplied = hex::decode(signature)
        .map_err(|_| Error::Unauthorized("invalid executor signature".to_string()))?;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&supplied)
        .map_err(|_| Error::Unauthorized("invalid executor signature".to_string()))
}

fn public_completion_url(run_id: uuid::Uuid) -> Result<String> {
    let origin = env::var("LOOPTASK_PUBLIC_ORIGIN").map_err(|_| {
        Error::Config("LOOPTASK_PUBLIC_ORIGIN is required for executor callbacks".to_string())
    })?;
    public_completion_url_from_origin(&origin, run_id)
}

fn public_completion_url_from_origin(origin: &str, run_id: uuid::Uuid) -> Result<String> {
    let mut url = reqwest::Url::parse(origin)
        .map_err(|_| Error::Config("LOOPTASK_PUBLIC_ORIGIN must be an absolute URL".to_string()))?;
    let host = url.host_str().unwrap_or_default();
    let local_debug =
        cfg!(debug_assertions) && (host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1");
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || (url.scheme() != "https" && !(url.scheme() == "http" && local_debug))
    {
        return Err(Error::Config("LOOPTASK_PUBLIC_ORIGIN must be an HTTPS origin without path, credentials, query, or fragment".to_string()));
    }
    url.set_path(&format!("/api/v1/runs/{run_id}/completion"));
    Ok(url.to_string())
}

#[cfg(test)]
mod completion_tests {
    use super::{public_completion_url_from_origin, verify_executor_signature_values};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    #[test]
    fn accepts_only_fresh_exact_body_hmac() {
        let timestamp = "1000";
        let body = br#"{"callbackId":"one"}"#;
        let mut mac = Hmac::<Sha256>::new_from_slice(b"secret").unwrap();
        mac.update(b"1000.");
        mac.update(body);
        let signature = hex::encode(mac.finalize().into_bytes());
        assert!(
            verify_executor_signature_values(timestamp, &signature, body, "secret", 1001).is_ok()
        );
        assert!(
            verify_executor_signature_values(
                timestamp,
                &signature,
                br#"{"callbackId":"two"}"#,
                "secret",
                1001
            )
            .is_err()
        );
        assert!(
            verify_executor_signature_values(timestamp, &signature, body, "secret", 1301).is_err()
        );
    }

    #[test]
    fn callback_origin_must_be_absolute_and_safe() {
        let url =
            public_completion_url_from_origin("https://control.example.com", uuid::Uuid::nil())
                .unwrap();
        assert_eq!(
            url,
            "https://control.example.com/api/v1/runs/00000000-0000-0000-0000-000000000000/completion"
        );
        assert!(
            public_completion_url_from_origin(
                "https://control.example.com/not-an-origin",
                uuid::Uuid::nil()
            )
            .is_err()
        );
    }
}

fn validate_completion(value: &ExecutorCompletion) -> Result<()> {
    let id = |v: &str| {
        !v.is_empty()
            && v.len() <= 200
            && v.bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b':'))
    };
    if !id(&value.callback_id) || !id(&value.dispatch_id) {
        return Err(Error::Config(
            "invalid callbackId or dispatchId".to_string(),
        ));
    }
    if !crate::github::valid_branch(&value.head_branch) {
        return Err(Error::Config("invalid headBranch".to_string()));
    }
    if value.head_sha.len() != 40 && value.head_sha.len() != 64
        || !value.head_sha.bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err(Error::Config(
            "headSha must be a 40 or 64 character hexadecimal SHA".to_string(),
        ));
    }
    if value.summary.len() > 10_000 {
        return Err(Error::Config("summary is too long".to_string()));
    }
    Ok(())
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
    let loop_def = project
        .loops
        .iter()
        .find(|candidate| candidate.name == loop_name)
        .cloned()
        .ok_or_else(|| format!("loop '{loop_name}' not found"))?;
    if let crate::models::Trigger::Resident { interval_seconds } = &loop_def.trigger {
        if !(60..=31_536_000).contains(interval_seconds) {
            return Err("resident interval must be between 60 seconds and 365 days".to_string());
        }
    }
    Ok(loop_def)
}

async fn plan_loop(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
    Json(request): Json<LoopPlanRequest>,
) -> Result<Json<LoopPlanResponse>> {
    let loop_def = match build_loop_plan(&request.project, &request.loop_name) {
        Ok(loop_def) => loop_def,
        Err(reason) => {
            return Ok(Json(LoopPlanResponse {
                accepted: false,
                reason,
                loop_plan: None,
            }));
        }
    };

    if let Some(store) = &state.projects {
        store
            .save_project(authenticated.user.id, &request.project)
            .await?;
    }
    let agent_cell_id = celld::agent_cell_id(&request.project, &loop_def, &request.agent_key);
    let foundation = celld::foundation(&request.project);
    Ok(Json(LoopPlanResponse {
        accepted: true,
        reason: "loop can be dispatched to a celld-backed agent cell".to_string(),
        loop_plan: Some(LoopPlan {
            project: request.project.name.clone(),
            loop_def,
            agent_cell_id,
            celld: foundation,
        }),
    }))
}

/// Plans a loop and, on acceptance, actually dispatches it by enqueuing a
/// wakeup event into the target agent cell's celld inbox. This is the
/// dispatch step described in `README.md`'s outer-loop positioning.
async fn dispatch_loop(
    State(state): State<AppState>,
    Extension(authenticated): Extension<AuthenticatedUser>,
    Json(request): Json<LoopPlanRequest>,
) -> Result<Json<LoopDispatchResponse>> {
    let loop_def = match build_loop_plan(&request.project, &request.loop_name) {
        Ok(loop_def) => loop_def,
        Err(reason) => {
            return Ok(Json(LoopDispatchResponse {
                accepted: false,
                reason,
                loop_plan: None,
                dispatch: None,
                run_id: None,
                deduplicated: false,
            }));
        }
    };

    let agent_cell_id = celld::agent_cell_id(&request.project, &loop_def, &request.agent_key);
    let generated_idempotency_key;
    let idempotency_key = match request
        .idempotency_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        Some(key) => key,
        None => {
            generated_idempotency_key = uuid::Uuid::new_v4().to_string();
            generated_idempotency_key.as_str()
        }
    };
    if idempotency_key.len() > 200 {
        return Err(Error::Config("idempotencyKey is too long".to_string()));
    }
    let prepared_run = if let Some(store) = &state.projects {
        Some(
            store
                .prepare_run(
                    authenticated.user.id,
                    &request.project,
                    &loop_def,
                    &request.agent_key,
                    &agent_cell_id,
                    idempotency_key,
                )
                .await?,
        )
    } else {
        None
    };
    if let Some(prepared) = &prepared_run {
        if !prepared.created {
            let foundation = celld::foundation(&request.project);
            return Ok(Json(LoopDispatchResponse {
                accepted: true,
                reason: "loop already dispatched for this idempotency key".to_string(),
                loop_plan: Some(LoopPlan {
                    project: request.project.name.clone(),
                    loop_def,
                    agent_cell_id,
                    celld: foundation,
                }),
                dispatch: Some(celld::InboxAck {
                    accepted: true,
                    id: format!("run-{}", prepared.id),
                }),
                run_id: Some(prepared.id),
                deduplicated: true,
            }));
        }
    }
    let completion_callback_url = match &prepared_run {
        Some(run) => Some(public_completion_url(run.id)?),
        None => None,
    };
    let event = celld::InboxEvent {
        id: None,
        source: "looptask-dispatch".to_string(),
        body: json!({
            "loop": loop_def.name,
            "kind": loop_def.kind,
            "goal": loop_def.goal,
            "mode": loop_def.mode,
            "repository": request.project.repository,
            "defaultBranch": request.project.default_branch,
            "runId": prepared_run.as_ref().map(|run| run.id),
            "completionCallback": completion_callback_url.map(|url| json!({
                "url": url,
                "method": "POST",
                "authentication": {
                    "algorithm": "HMAC-SHA256",
                    "timestampHeader": "x-looptask-timestamp",
                    "signatureHeader": "x-looptask-signature",
                    "signedPayload": "timestamp + '.' + exact raw JSON request body",
                    "timestampWindowSeconds": 300
                }
            })),
            "steps": loop_def.steps,
            "verifiers": loop_def.verifiers,
            "safety": loop_def.safety,
            "resident": match &loop_def.trigger {
                crate::models::Trigger::Resident { interval_seconds } => {
                    Some(json!({ "intervalSeconds": interval_seconds }))
                }
                _ => None,
            },
        }),
        wake_at: match &loop_def.trigger {
            crate::models::Trigger::Resident { .. } => Some(chrono::Utc::now()),
            _ => None,
        },
    };

    let client = celld::CelldClient::for_project(&request.project)?;
    let ack = match client.enqueue_inbox(&agent_cell_id, &event).await {
        Ok(ack) => ack,
        Err(error) => {
            if let (Some(store), Some(prepared)) = (&state.projects, &prepared_run) {
                store.mark_failed(prepared.id, &error.to_string()).await?;
            }
            return Err(error);
        }
    };
    if let (Some(store), Some(prepared)) = (&state.projects, &prepared_run) {
        store.mark_running(prepared.id, &ack.id).await?;
    }

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
        run_id: prepared_run.map(|run| run.id),
        deduplicated: false,
    }))
}

async fn stop_resident(
    Extension(_authenticated): Extension<AuthenticatedUser>,
    Json(request): Json<LoopPlanRequest>,
) -> Result<Json<celld::ResidentCancelAck>> {
    let loop_def = build_loop_plan(&request.project, &request.loop_name).map_err(Error::Config)?;
    if !matches!(&loop_def.trigger, crate::models::Trigger::Resident { .. }) {
        return Err(Error::Config(
            "the selected loop is not configured for resident execution".to_string(),
        ));
    }
    let agent_cell_id = celld::agent_cell_id(&request.project, &loop_def, &request.agent_key);
    let client = celld::CelldClient::for_project(&request.project)?;
    Ok(Json(
        client
            .cancel_resident(&agent_cell_id, &loop_def.name)
            .await?,
    ))
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
    #[serde(default)]
    pub idempotency_key: Option<String>,
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
    pub run_id: Option<uuid::Uuid>,
    pub deduplicated: bool,
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
