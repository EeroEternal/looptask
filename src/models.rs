use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub repository: Option<String>,
    #[serde(default = "default_branch")]
    pub default_branch: String,
    #[serde(default)]
    pub tech_stack: Vec<String>,
    #[serde(default)]
    pub docs: Vec<String>,
    #[serde(default)]
    pub source_paths: Vec<String>,
    #[serde(default)]
    pub external_data_sources: Vec<ExternalDataSource>,
    #[serde(default)]
    pub celld: CelldRuntime,
    #[serde(default)]
    pub loops: Vec<LoopDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDataSource {
    pub name: String,
    pub url: String,
    pub cache_path: String,
    pub schema_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CelldRuntime {
    pub app_dir: String,
    pub bucket: Option<String>,
    pub public_url: Option<String>,
    pub internal_url: Option<String>,
    #[serde(default)]
    pub durable_object_class: String,
    #[serde(default)]
    pub artifact_bucket_prefix: String,
}

impl Default for CelldRuntime {
    fn default() -> Self {
        Self {
            app_dir: "celld".to_string(),
            bucket: None,
            public_url: Some("http://127.0.0.1:9876".to_string()),
            internal_url: None,
            durable_object_class: "AgentCell".to_string(),
            artifact_bucket_prefix: "agents".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopDefinition {
    pub name: String,
    pub kind: LoopKind,
    pub goal: String,
    #[serde(default)]
    pub mode: LoopMode,
    #[serde(default)]
    pub trigger: Trigger,
    #[serde(default)]
    pub agent: AgentProfile,
    #[serde(default)]
    pub verifiers: Vec<Verifier>,
    #[serde(default)]
    pub state: StatePolicy,
    #[serde(default)]
    pub stop_rules: StopRules,
    #[serde(default)]
    pub escalation_rules: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoopKind {
    DocsSync,
    ExternalDataSync,
    ArchitectureScan,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LoopMode {
    #[default]
    ReportOnly,
    SafePr,
    HumanGated,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Trigger {
    Cron {
        schedule: String,
    },
    GitHubEvent {
        event: String,
    },
    #[default]
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub cell_id_template: String,
    #[serde(default)]
    pub sandbox_required: bool,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub human_gate: bool,
}

impl Default for AgentProfile {
    fn default() -> Self {
        Self {
            cell_id_template: "{project}/{loop}".to_string(),
            sandbox_required: true,
            allowed_tools: Vec::new(),
            human_gate: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Verifier {
    pub name: String,
    pub command: Vec<String>,
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePolicy {
    pub hot_sqlite_scope: String,
    pub artifact_uri_prefix: String,
    #[serde(default = "default_hot_message_limit")]
    pub hot_message_limit: u32,
}

impl Default for StatePolicy {
    fn default() -> Self {
        Self {
            hot_sqlite_scope: "agent-cell".to_string(),
            artifact_uri_prefix: "r2://agents/{agent}/artifacts/".to_string(),
            hot_message_limit: 50,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopRules {
    #[serde(default = "default_max_steps")]
    pub max_steps: u32,
    #[serde(default = "default_max_failures")]
    pub max_consecutive_failures: u32,
    #[serde(default = "default_large_file_lines")]
    pub large_file_lines: u32,
}

impl Default for StopRules {
    fn default() -> Self {
        Self {
            max_steps: default_max_steps(),
            max_consecutive_failures: default_max_failures(),
            large_file_lines: default_large_file_lines(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopRun {
    pub id: Uuid,
    pub project: String,
    pub loop_name: String,
    pub status: RunStatus,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub agent_cell_id: String,
    pub verifier_results: Vec<VerifierResult>,
    pub artifacts: Vec<ArtifactRef>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunStatus {
    Queued,
    Running,
    Passed,
    Failed,
    NeedsHuman,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifierResult {
    pub name: String,
    pub exit_code: i32,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRef {
    pub id: String,
    pub kind: String,
    pub storage_uri: String,
    pub sha256: Option<String>,
    pub bytes: u64,
    pub preview: Option<String>,
}

fn default_branch() -> String {
    "main".to_string()
}

fn default_timeout_seconds() -> u64 {
    300
}

fn default_hot_message_limit() -> u32 {
    50
}

fn default_max_steps() -> u32 {
    12
}

fn default_max_failures() -> u32 {
    3
}

fn default_large_file_lines() -> u32 {
    500
}
