use serde::{Deserialize, Serialize};

use crate::models::{
    AgentProfile, DecisionRule, LoopBudget, LoopDefinition, LoopKind, LoopMode, LoopSafety,
    LoopStep, StatePolicy, StopRules, Trigger, Verifier,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopTemplate {
    pub id: String,
    pub name: String,
    pub kind: LoopKind,
    pub summary: String,
    pub definition: LoopDefinition,
    pub capability_tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopValidationRequest {
    pub project: crate::models::Project,
    pub loop_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopValidationResponse {
    pub accepted: bool,
    pub summary: String,
    #[serde(rename = "loop")]
    pub loop_definition: LoopDefinition,
    pub stages: Vec<LoopStage>,
    pub guardrails: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopStage {
    pub id: String,
    pub title: String,
    pub purpose: String,
    pub safety: String,
}

pub fn templates() -> Vec<LoopTemplate> {
    vec![docs_lifecycle_patrol()]
}

pub fn find_template(id: &str) -> Option<LoopTemplate> {
    templates().into_iter().find(|template| template.id == id)
}

pub fn validate(
    project: &crate::models::Project,
    loop_name: Option<&str>,
) -> LoopValidationResponse {
    let selected = loop_name
        .and_then(|name| project.loops.iter().find(|loop_def| loop_def.name == name))
        .or_else(|| project.loops.first())
        .cloned()
        .unwrap_or_else(|| docs_lifecycle_patrol().definition);
    let mut guardrails = vec![
        "永不 merge、永不打 tag、永不 push main".to_string(),
        "所有变更必须先在独立 worktree 中完成".to_string(),
        "预算触顶立即停止，并创建 budget-exceeded issue".to_string(),
    ];
    guardrails.extend(selected.safety.forbidden_actions.iter().cloned());
    LoopValidationResponse {
        accepted: !selected.name.trim().is_empty() && !selected.steps.is_empty(),
        summary: if selected.summary.is_empty() {
            selected.goal.clone()
        } else {
            selected.summary.clone()
        },
        stages: selected
            .steps
            .iter()
            .map(|step| LoopStage {
                id: step.id.clone(),
                title: step.title.clone(),
                purpose: step.purpose.clone(),
                safety: if step.allowed_paths.is_empty() {
                    "只读或受控操作".to_string()
                } else {
                    format!("白名单：{}", step.allowed_paths.join("、"))
                },
            })
            .collect(),
        loop_definition: selected,
        guardrails,
    }
}

fn docs_lifecycle_patrol() -> LoopTemplate {
    let definition = LoopDefinition {
        name: "docs-lifecycle-patrol".to_string(),
        kind: LoopKind::DocsSync,
        goal: "巡检文档生命周期，机械修复断链/残缺内容，并将候审事项交给人工裁决".to_string(),
        summary: "对文档仓库进行隔离、可验证、可回收的生命周期巡检".to_string(),
        mode: LoopMode::HumanGated,
        trigger: Trigger::Manual,
        agent: AgentProfile {
            cell_id_template: "{project}/{loop}/{agent}".to_string(),
            sandbox_required: true,
            allowed_tools: vec![
                "git".to_string(),
                "bash".to_string(),
                "gh".to_string(),
                "read-repo".to_string(),
            ],
            human_gate: true,
        },
        verifiers: vec![
            Verifier {
                name: "docs-lifecycle".to_string(),
                command: vec![
                    "bash".to_string(),
                    "scripts/check_docs_lifecycle.sh".to_string(),
                ],
                timeout_seconds: 900,
            },
            Verifier {
                name: "release-sync".to_string(),
                command: vec![
                    "bash".to_string(),
                    "scripts/check_release_sync.sh".to_string(),
                ],
                timeout_seconds: 900,
            },
        ],
        state: StatePolicy::default(),
        stop_rules: StopRules {
            max_steps: 12,
            max_consecutive_failures: 2,
            large_file_lines: 500,
        },
        escalation_rules: vec![
            "发现白名单外路径改动需求时立即停止并开 issue".to_string(),
            "发现 landed:/promote:/artifact: 时不裁决，只提交证据".to_string(),
        ],
        steps: vec![
            LoopStep {
                id: "isolate".to_string(),
                title: "同步并创建隔离 worktree".to_string(),
                purpose: "基于 origin/main 最新提交创建独立分支，禁止触碰既有检出目录与未提交状态"
                    .to_string(),
                command: vec!["git".to_string(), "fetch".to_string(), "origin".to_string()],
                allowed_paths: vec![],
                forbidden_actions: vec![
                    "read-or-write-existing-checkout".to_string(),
                    "touch-uncommitted-state".to_string(),
                ],
            },
            LoopStep {
                id: "inspect".to_string(),
                title: "运行文档生命周期巡检".to_string(),
                purpose: "在独立 worktree 执行检查脚本，并按退出码与信号分类".to_string(),
                command: vec![
                    "bash".to_string(),
                    "scripts/check_docs_lifecycle.sh".to_string(),
                ],
                allowed_paths: vec![],
                forbidden_actions: vec![],
            },
            LoopStep {
                id: "repair".to_string(),
                title: "机械修复断链与残缺".to_string(),
                purpose: "仅允许修改 docs/** 与 .agents/**，修复后必须双绿".to_string(),
                command: vec![
                    "bash".to_string(),
                    "scripts/check_docs_lifecycle.sh".to_string(),
                    "&&".to_string(),
                    "bash".to_string(),
                    "scripts/check_release_sync.sh".to_string(),
                ],
                allowed_paths: vec!["docs/**".to_string(), ".agents/**".to_string()],
                forbidden_actions: vec!["architecture-refactor".to_string()],
            },
            LoopStep {
                id: "escalate".to_string(),
                title: "候审信号交人工裁决".to_string(),
                purpose: "对 landed/promote/artifact 只记录证据并创建 issue，不自动裁决"
                    .to_string(),
                command: vec!["gh".to_string(), "issue".to_string(), "create".to_string()],
                allowed_paths: vec![],
                forbidden_actions: vec!["auto-adjudicate".to_string()],
            },
            LoopStep {
                id: "budget".to_string(),
                title: "硬预算与现场报告".to_string(),
                purpose: "30 分钟或 200 次工具调用任一触顶，立即停止并创建现场 issue".to_string(),
                command: vec![],
                allowed_paths: vec![],
                forbidden_actions: vec![],
            },
            LoopStep {
                id: "cleanup".to_string(),
                title: "清理 worktree".to_string(),
                purpose: "未开 PR 删除 worktree 与分支，开 PR 只保留分支并清理 worktree"
                    .to_string(),
                command: vec![
                    "git".to_string(),
                    "worktree".to_string(),
                    "remove".to_string(),
                ],
                allowed_paths: vec![],
                forbidden_actions: vec![],
            },
        ],
        decision_rules: vec![
            DecisionRule {
                signal: "exit_code == 0".to_string(),
                action: "追加 green 日志并结束，不开 PR/issue".to_string(),
                evidence_required: vec!["耗时".to_string(), "调用数".to_string()],
            },
            DecisionRule {
                signal: "broken: or mangled:".to_string(),
                action: "白名单内机械修复，双绿后推送分支并创建 loop(docs): PR".to_string(),
                evidence_required: vec![
                    "发现清单".to_string(),
                    "修复方式".to_string(),
                    "预算消耗".to_string(),
                ],
            },
            DecisionRule {
                signal: "landed: or promote: or artifact:".to_string(),
                action: "创建 [loop-adjudication] issue，不修改".to_string(),
                evidence_required: vec!["证据清单".to_string(), "建议裁决问题".to_string()],
            },
            DecisionRule {
                signal: "budget exceeded".to_string(),
                action: "立即停止并创建现场 issue，追加 budget-exceeded 日志".to_string(),
                evidence_required: vec!["已完成".to_string(), "未完成".to_string()],
            },
        ],
        budget: LoopBudget {
            max_duration_minutes: 30,
            max_tool_calls: 200,
        },
        safety: LoopSafety {
            protected_branches: vec!["main".to_string(), "master".to_string()],
            allowed_paths: vec!["docs/**".to_string(), ".agents/**".to_string()],
            forbidden_actions: vec![
                "merge".to_string(),
                "tag".to_string(),
                "push-main".to_string(),
                "write-outside-allowlist".to_string(),
            ],
            cleanup_policy: "no-pr-delete-branch-and-worktree; pr-open-keep-branch-remove-worktree"
                .to_string(),
        },
    };
    LoopTemplate {
        id: "docs-lifecycle-patrol".to_string(),
        name: "文档生命周期巡检车道".to_string(),
        kind: LoopKind::DocsSync,
        summary: definition.summary.clone(),
        definition,
        capability_tags: vec![
            "隔离 worktree".to_string(),
            "机械修复".to_string(),
            "双重验证".to_string(),
            "人工裁决".to_string(),
        ],
    }
}
