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
    pub summary: String,
    #[serde(default)]
    pub mode: LoopMode,
    #[serde(default)]
    pub trigger: Trigger,
    /// Standing vs finite lifetime. Omitted configs deserialize as standing.
    #[serde(default)]
    pub lifetime: LoopLifetime,
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
    #[serde(default)]
    pub steps: Vec<LoopStep>,
    #[serde(default)]
    pub decision_rules: Vec<DecisionRule>,
    #[serde(default)]
    pub budget: LoopBudget,
    #[serde(default)]
    pub safety: LoopSafety,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopStep {
    pub id: String,
    pub title: String,
    pub purpose: String,
    #[serde(default)]
    pub command: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub forbidden_actions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionRule {
    pub signal: String,
    pub action: String,
    #[serde(default)]
    pub evidence_required: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopBudget {
    #[serde(default = "default_budget_minutes")]
    pub max_duration_minutes: u32,
    #[serde(default = "default_budget_calls")]
    pub max_tool_calls: u32,
}

impl Default for LoopBudget {
    fn default() -> Self {
        Self {
            max_duration_minutes: default_budget_minutes(),
            max_tool_calls: default_budget_calls(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopSafety {
    #[serde(default = "default_protected_branches")]
    pub protected_branches: Vec<String>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub forbidden_actions: Vec<String>,
    #[serde(default = "default_cleanup_policy")]
    pub cleanup_policy: String,
}

impl Default for LoopSafety {
    fn default() -> Self {
        Self {
            protected_branches: default_protected_branches(),
            allowed_paths: Vec::new(),
            forbidden_actions: Vec::new(),
            cleanup_policy: default_cleanup_policy(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoopKind {
    DocsSync,
    ExternalDataSync,
    ArchitectureScan,
    /// Finite watch for red CI / failing checks (design slice; scheduler TBD).
    CiWatch,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LoopMode {
    #[default]
    ReportOnly,
    SafePr,
    HumanGated,
}

/// Quiet window for cron triggers (local wall clock in `timezone` if set).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuietHours {
    pub start: String,
    pub end: String,
}

/// How long a loop stays armed. Runtime enforcement is a follow-up slice;
/// these fields are the durable config contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoopLifetime {
    #[serde(default)]
    pub kind: LifetimeKind,
    #[serde(default)]
    pub until: Option<LifetimeUntil>,
    #[serde(default = "default_on_expire")]
    pub on_expire: LifetimeExpireAction,
}

impl Default for LoopLifetime {
    fn default() -> Self {
        Self {
            kind: LifetimeKind::Standing,
            until: None,
            on_expire: default_on_expire(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LifetimeKind {
    #[default]
    Standing,
    Until,
    MaxRuns,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LifetimeUntil {
    #[serde(default)]
    pub any_of: Vec<LifetimeCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LifetimeCondition {
    #[serde(rename = "pr-merged")]
    PrMerged,
    #[serde(rename = "pr-closed")]
    PrClosed,
    #[serde(rename = "ci-passed")]
    CiPassed,
    #[serde(rename = "human-disable")]
    HumanDisable,
    #[serde(rename = "deadline")]
    Deadline { at: String },
    #[serde(rename = "maxRuns")]
    MaxRuns { count: u32 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LifetimeExpireAction {
    PauseAndArchive,
    Delete,
    KeepArmed,
}

fn default_on_expire() -> LifetimeExpireAction {
    LifetimeExpireAction::PauseAndArchive
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum Trigger {
    Cron {
        schedule: String,
        /// Optional IANA timezone; omit to follow operator/project default.
        #[serde(default)]
        timezone: Option<String>,
        #[serde(default)]
        quiet_hours: Option<QuietHours>,
    },
    /// High-frequency polling. Prefer event triggers in production; treat as
    /// debug-oriented unless interval is coarse.
    Resident {
        #[serde(default = "default_resident_interval_seconds")]
        interval_seconds: u64,
    },
    /// Legacy single-event GitHub trigger (`type: "gitHubEvent"`).
    GitHubEvent {
        event: String,
    },
    /// Filtered GitHub / CI trigger (`type: "github"`).
    #[serde(rename = "github")]
    GitHub {
        #[serde(default)]
        events: Vec<String>,
        #[serde(default)]
        paths: Vec<String>,
        #[serde(default)]
        branches: Vec<String>,
        #[serde(default)]
        pr_scoped: bool,
        #[serde(default)]
        ci_branch: Option<String>,
        #[serde(default)]
        user_allowlist: Vec<String>,
    },
    /// Fire when any nested listener matches (`type: "group"`).
    #[serde(rename = "group")]
    Group {
        listeners: Vec<Trigger>,
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
            artifact_uri_prefix: "r2://looptask/agents/{agent}/artifacts/".to_string(),
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
    /// Operator or policy pause; may resume.
    Paused,
    /// Heartbeat / progress stalled; needs steer or cancel.
    Stuck,
    /// Explicitly aborted.
    Cancelled,
}

/// Suggested `loop_events.event_type` values for Command Center (design).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LoopEventType {
    Progress,
    NeedsDecision,
    Steered,
    AuthFailed,
    BudgetHit,
    VerifierFailed,
    StuckDetected,
    Queued,
    Dispatched,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathAllowlistDelta {
    #[serde(default)]
    pub add: Vec<String>,
    #[serde(default)]
    pub remove: Vec<String>,
}

/// Mid-flight correction injected into the agent cell inbox. Expanding
/// `allowedPathsDelta.add` must be rejected by the control plane; only shrink
/// is allowed without a human charter PR.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteerRunRequest {
    pub intent: String,
    #[serde(default)]
    pub budget_override: Option<LoopBudget>,
    #[serde(default)]
    pub allowed_paths_delta: Option<PathAllowlistDelta>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunDecision {
    Approve,
    Reject,
    Redirect,
    Escalate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDecisionRequest {
    pub decision: RunDecision,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub redirect_intent: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DecisionCardKind {
    MergeConfirm,
    WidenAllowlist,
    AmbiguousFix,
    AuthReconnect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionCard {
    pub card_id: String,
    pub kind: DecisionCardKind,
    pub title: String,
    pub options: Vec<RunDecision>,
    #[serde(default)]
    pub blocks_run: bool,
}

/// Optional lesson candidate emitted on successful runs; promotion into loop
/// policy requires a human (see skill promote-lesson). Not auto-applied.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LessonCandidate {
    pub signal: String,
    pub suggested_policy: String,
    #[serde(default = "default_true")]
    pub needs_human_promote: bool,
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

fn default_resident_interval_seconds() -> u64 {
    900
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

fn default_budget_minutes() -> u32 {
    30
}

fn default_budget_calls() -> u32 {
    200
}

fn default_protected_branches() -> Vec<String> {
    vec!["main".to_string(), "master".to_string()]
}

fn default_cleanup_policy() -> String {
    "remove-worktree; keep-branch-only-when-pr-open".to_string()
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_github_event_trigger_still_deserializes() {
        let trigger: Trigger = serde_json::from_str(
            r#"{"type":"gitHubEvent","event":"push"}"#,
        )
        .unwrap();
        assert!(matches!(trigger, Trigger::GitHubEvent { event } if event == "push"));
    }

    #[test]
    fn github_and_group_triggers_deserialize() {
        let trigger: Trigger = serde_json::from_str(
            r#"{
              "type":"group",
              "listeners":[
                {
                  "type":"github",
                  "events":["pr-pushed","ci-failed"],
                  "paths":["docs/**"],
                  "branches":["main"]
                },
                {"type":"cron","schedule":"0 9 * * 1-5","timezone":"Asia/Shanghai"}
              ]
            }"#,
        )
        .unwrap();
        match trigger {
            Trigger::Group { listeners } => {
                assert_eq!(listeners.len(), 2);
                assert!(matches!(listeners[0], Trigger::GitHub { .. }));
                assert!(matches!(listeners[1], Trigger::Cron { .. }));
            }
            other => panic!("unexpected trigger: {other:?}"),
        }
    }

    #[test]
    fn lifetime_defaults_to_standing() {
        let lifetime: LoopLifetime = serde_json::from_str("{}").unwrap();
        assert_eq!(lifetime.kind, LifetimeKind::Standing);
        assert_eq!(lifetime.on_expire, LifetimeExpireAction::PauseAndArchive);
    }
}