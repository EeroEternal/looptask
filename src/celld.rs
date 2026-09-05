use std::{net::IpAddr, time::Duration};

use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::{LoopDefinition, Project};
use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CelldFoundation {
    pub role: String,
    pub durable_object_class: String,
    pub state_strategy: StateStrategy,
    pub sandbox_boundary: SandboxBoundary,
    pub local_dev_command: String,
    pub deploy_command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateStrategy {
    pub hot_state: Vec<String>,
    pub cold_artifacts: Vec<String>,
    pub rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxBoundary {
    pub celld_handles: Vec<String>,
    pub external_sandbox_handles: Vec<String>,
    pub warning: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactPlacement {
    CellSqlite,
    ObjectStorage,
}

pub fn foundation(project: &Project) -> CelldFoundation {
    CelldFoundation {
        role: "per-agent durable brain, inbox, scheduler, and state ledger".to_string(),
        durable_object_class: project.celld.durable_object_class.clone(),
        state_strategy: StateStrategy {
            hot_state: vec![
                "agent identity and policy".to_string(),
                "current plan, inbox, checkpoints, and short memory summaries".to_string(),
                "artifact metadata and object-storage pointers".to_string(),
            ],
            cold_artifacts: vec![
                "generated files, patches, repository snapshots, and long logs".to_string(),
                "large model/tool outputs and external data snapshots".to_string(),
                "sandbox workspaces and build artifacts".to_string(),
            ],
            rule: "cell SQLite stores who the agent is, what it is doing, and where artifacts live; object storage stores the artifacts themselves".to_string(),
        },
        sandbox_boundary: SandboxBoundary {
            celld_handles: vec![
                "named agent cells".to_string(),
                "serialized events".to_string(),
                "durable SQLite state".to_string(),
                "alarms and inbox wakeups".to_string(),
            ],
            external_sandbox_handles: vec![
                "untrusted code execution".to_string(),
                "shell commands".to_string(),
                "dependency installation".to_string(),
                "workspace file-system mutation".to_string(),
            ],
            warning: "celld is not a hostile multi-tenant sandbox; execute untrusted agent actions in a separate sandbox and write results back to the cell".to_string(),
        },
        local_dev_command: format!("cd {} && celld dev", project.celld.app_dir),
        deploy_command: project
            .celld
            .bucket
            .as_ref()
            .map(|bucket| format!("cd {} && celld deploy . --bucket {bucket}", project.celld.app_dir)),
    }
}

pub fn agent_cell_id(project: &Project, loop_def: &LoopDefinition, agent_key: &str) -> String {
    loop_def
        .agent
        .cell_id_template
        .replace("{project}", &project.name)
        .replace("{loop}", &loop_def.name)
        .replace("{agent}", agent_key)
}

pub fn artifact_placement(
    bytes: u64,
    needed_for_next_decision: bool,
    shared: bool,
) -> ArtifactPlacement {
    if bytes > 512 * 1024 || shared || !needed_for_next_decision {
        ArtifactPlacement::ObjectStorage
    } else {
        ArtifactPlacement::CellSqlite
    }
}

/// Hot-state snapshot reported by an `AgentCell` Durable Object, mirroring
/// `celld/src/agent_cell.js`'s `state()` handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellState {
    pub inbox: u32,
    pub tasks: u32,
    pub artifacts: u32,
}

/// Event enqueued into an agent cell's inbox, matching the JSON body accepted
/// by `AgentCell.enqueue` (`POST /agents/{id}/inbox`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default = "default_event_source")]
    pub source: String,
    #[serde(default)]
    pub body: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wake_at: Option<DateTime<Utc>>,
}

fn default_event_source() -> String {
    "looptask".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxAck {
    pub accepted: bool,
    pub id: String,
}

/// Artifact metadata recorded against a cell, matching the JSON body accepted
/// by `AgentCell.recordArtifact` (`POST /agents/{id}/artifacts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub kind: String,
    pub storage_uri: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default)]
    pub bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactAck {
    pub recorded: bool,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentCancelAck {
    pub cancelled: u32,
}

/// HTTP client for the celld Durable Object app (`celld/src/worker.js`).
///
/// Agent cell IDs (e.g. `looptask/docs-sync/docs`) commonly contain `/`.
/// celld's worker routes `/agents/{id}(/...)` by matching a single path
/// segment and `decodeURIComponent`-ing it, so the ID must be sent
/// percent-encoded as one segment (`%2F` for `/`). `Url::path_segments_mut`
/// does this automatically when the ID is pushed via `.push(...)` instead of
/// being interpolated into the path string.
#[derive(Debug, Clone)]
pub struct CelldClient {
    http: Client,
    base_url: String,
}

impl CelldClient {
    /// Builds a client from a project's configured celld URL, preferring the
    /// internal (service-to-service) URL over the public one when both are
    /// set.
    pub fn for_project(project: &Project) -> Result<Self> {
        let base_url = project
            .celld
            .internal_url
            .clone()
            .or_else(|| project.celld.public_url.clone())
            .ok_or_else(|| {
                Error::Config(
                    "project.celld.internalUrl or publicUrl is required to reach celld".to_string(),
                )
            })?;
        Self::new(base_url)
    }

    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let base_url = base_url.into();
        validate_base_url(&base_url)?;
        let http = Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| Error::Celld(format!("failed to build celld HTTP client: {error}")))?;
        Ok(Self { http, base_url })
    }

    fn cell_url(&self, agent_cell_id: &str, path_segments: &[&str]) -> Result<reqwest::Url> {
        let mut url = reqwest::Url::parse(&self.base_url)
            .map_err(|error| Error::Config(format!("invalid celld base url: {error}")))?;
        {
            let mut segments = url.path_segments_mut().map_err(|()| {
                Error::Config("celld base url must be an absolute http(s) URL".to_string())
            })?;
            segments.pop_if_empty();
            segments.push("agents").push(agent_cell_id);
            for segment in path_segments {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    /// Fetches the hot-state summary for an agent cell (`GET /state`).
    pub async fn cell_state(&self, agent_cell_id: &str) -> Result<CellState> {
        let url = self.cell_url(agent_cell_id, &["state"])?;
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(celld_request_error)?;
        read_celld_json(response).await
    }

    /// Enqueues an event into an agent cell's inbox (`POST /inbox`), waking
    /// the cell via a durable alarm when `event.wake_at` is set.
    pub async fn enqueue_inbox(&self, agent_cell_id: &str, event: &InboxEvent) -> Result<InboxAck> {
        let url = self.cell_url(agent_cell_id, &["inbox"])?;
        let response = self
            .http
            .post(url)
            .json(event)
            .send()
            .await
            .map_err(celld_request_error)?;
        read_celld_json(response).await
    }

    /// Records artifact metadata against an agent cell (`POST /artifacts`).
    pub async fn record_artifact(
        &self,
        agent_cell_id: &str,
        artifact: &ArtifactRecord,
    ) -> Result<ArtifactAck> {
        let url = self.cell_url(agent_cell_id, &["artifacts"])?;
        let response = self
            .http
            .post(url)
            .json(artifact)
            .send()
            .await
            .map_err(celld_request_error)?;
        read_celld_json(response).await
    }

    /// Cancels all persisted resident schedules for a loop in an agent cell.
    pub async fn cancel_resident(
        &self,
        agent_cell_id: &str,
        loop_name: &str,
    ) -> Result<ResidentCancelAck> {
        let url = self.cell_url(agent_cell_id, &["resident", "cancel"])?;
        let response = self
            .http
            .post(url)
            .json(&serde_json::json!({ "loop": loop_name }))
            .send()
            .await
            .map_err(celld_request_error)?;
        read_celld_json(response).await
    }
}

fn validate_base_url(base_url: &str) -> Result<()> {
    let allowed_origins = std::env::var("LOOPTASK_CELLD_ALLOWED_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    validate_base_url_with_allowed_origins(base_url, &allowed_origins)
}

fn validate_base_url_with_allowed_origins(
    base_url: &str,
    allowed_origins: &[String],
) -> Result<()> {
    let url = reqwest::Url::parse(base_url)
        .map_err(|error| Error::Config(format!("invalid celld base url: {error}")))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::Config(
            "celld base url must not contain credentials".to_string(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| Error::Config("celld base url must include a host".to_string()))?;
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(Error::Config(
            "celld base url must be an origin without a path, query, or fragment".to_string(),
        ));
    }
    let local_debug_host = cfg!(debug_assertions)
        && (host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .map(|address| address.is_loopback())
                .unwrap_or(false));
    if url.scheme() != "https" && !(url.scheme() == "http" && local_debug_host) {
        return Err(Error::Config(
            "celld base url must use https outside local development".to_string(),
        ));
    }
    if local_debug_host {
        return Ok(());
    }
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.eq_ignore_ascii_case("metadata.google.internal")
    {
        return Err(Error::Config(
            "celld base url must not target a local or internal hostname".to_string(),
        ));
    }
    if let Ok(address) = host.parse::<IpAddr>() {
        if is_non_public_address(address) {
            return Err(Error::Config(
                "celld base url must not target a private or special-use address".to_string(),
            ));
        }
    }
    let origin = url.origin().ascii_serialization();
    if !allowed_origins.iter().any(|allowed| allowed == &origin) {
        return Err(Error::Config(format!(
            "celld origin {origin} is not listed in LOOPTASK_CELLD_ALLOWED_ORIGINS"
        )));
    }
    Ok(())
}

fn is_non_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_broadcast()
                || address.is_documentation()
                || address.is_unspecified()
                || address.is_multicast()
        }
        IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
                || address.is_multicast()
        }
    }
}

fn celld_request_error(error: reqwest::Error) -> Error {
    Error::Celld(format!("failed to reach celld: {error}"))
}

async fn read_celld_json<T: serde::de::DeserializeOwned>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(Error::Celld(format!(
            "celld responded with {status}: {body}"
        )));
    }
    response
        .json::<T>()
        .await
        .map_err(|error| Error::Celld(format!("invalid celld response body: {error}")))
}

#[cfg(test)]
mod tests {
    use super::validate_base_url_with_allowed_origins;

    #[test]
    fn rejects_unlisted_public_celld_origin() {
        let result = validate_base_url_with_allowed_origins("https://celld.example.com", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn accepts_exactly_allowlisted_celld_origin() {
        let allowed = vec!["https://celld.example.com".to_string()];
        let result = validate_base_url_with_allowed_origins("https://celld.example.com", &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_allowlisted_origin_with_untrusted_path() {
        let allowed = vec!["https://celld.example.com".to_string()];
        let result =
            validate_base_url_with_allowed_origins("https://celld.example.com/internal", &allowed);
        assert!(result.is_err());
    }
}
