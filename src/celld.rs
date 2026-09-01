use serde::{Deserialize, Serialize};

use crate::models::{LoopDefinition, Project};

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
