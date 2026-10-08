// Loop catalog: built-in loop templates (port of the former src/loop_catalog.rs).
export const docsLifecycleTemplate = {
  id: "docs-lifecycle-patrol",
  name: "文档生命周期巡检车道",
  kind: "docs_sync",
  summary: "对文档仓库进行隔离、可验证、可回收的生命周期巡检",
  capabilityTags: ["隔离 worktree", "机械修复", "双重验证", "人工裁决"],
  definition: {
    name: "docs-lifecycle-patrol",
    kind: "docs_sync",
    goal: "巡检文档生命周期，机械修复断链/残缺内容，并将候审事项交给人工裁决",
    summary: "对文档仓库进行隔离、可验证、可回收的生命周期巡检",
    mode: "human-gated",
    trigger: { type: "manual" },
    agent: {
      cellIdTemplate: "{project}/{loop}/{agent}",
      sandboxRequired: true,
      allowedTools: ["git", "bash", "gh", "read-repo"],
      humanGate: true,
    },
    verifiers: [
      {
        name: "docs-lifecycle",
        command: ["bash", "scripts/check_docs_lifecycle.sh"],
        timeoutSeconds: 900,
      },
      {
        name: "release-sync",
        command: ["bash", "scripts/check_release_sync.sh"],
        timeoutSeconds: 900,
      },
    ],
    state: {
      hotSqliteScope: "agent-cell",
      artifactUriPrefix: "r2://looptask/agents/{agent}/artifacts/",
      hotMessageLimit: 50,
    },
    stopRules: { maxSteps: 12, maxConsecutiveFailures: 2, largeFileLines: 500 },
    escalationRules: [
      "发现白名单外路径改动需求时立即停止并开 issue",
      "发现 landed:/promote:/artifact: 时不裁决，只提交证据",
    ],
    steps: [
      {
        id: "isolate",
        title: "同步并创建隔离 worktree",
        purpose: "基于 origin/main 最新提交创建独立分支，禁止触碰既有检出目录与未提交状态",
        command: ["git", "fetch", "origin"],
        allowedPaths: [],
        forbiddenActions: ["read-or-write-existing-checkout", "touch-uncommitted-state"],
      },
      {
        id: "inspect",
        title: "运行文档生命周期巡检",
        purpose: "在独立 worktree 执行检查脚本，并按退出码与信号分类",
        command: ["bash", "scripts/check_docs_lifecycle.sh"],
        allowedPaths: [],
        forbiddenActions: [],
      },
      {
        id: "repair",
        title: "机械修复断链与残缺",
        purpose: "仅允许修改 docs/** 与 .agents/**，修复后必须双绿",
        command: [
          "bash",
          "scripts/check_docs_lifecycle.sh",
          "&&",
          "bash",
          "scripts/check_release_sync.sh",
        ],
        allowedPaths: ["docs/**", ".agents/**"],
        forbiddenActions: ["architecture-refactor"],
      },
      {
        id: "escalate",
        title: "候审信号交人工裁决",
        purpose: "对 landed/promote/artifact 只记录证据并创建 issue，不自动裁决",
        command: ["gh", "issue", "create"],
        allowedPaths: [],
        forbiddenActions: ["auto-adjudicate"],
      },
      {
        id: "budget",
        title: "硬预算与现场报告",
        purpose: "30 分钟或 200 次工具调用任一触顶，立即停止并创建现场 issue",
        command: [],
        allowedPaths: [],
        forbiddenActions: [],
      },
      {
        id: "cleanup",
        title: "清理 worktree",
        purpose: "未开 PR 删除 worktree 与分支，开 PR 只保留分支并清理 worktree",
        command: ["git", "worktree", "remove"],
        allowedPaths: [],
        forbiddenActions: [],
      },
    ],
    decisionRules: [
      {
        signal: "exit_code == 0",
        action: "追加 green 日志并结束，不开 PR/issue",
        evidenceRequired: ["耗时", "调用数"],
      },
      {
        signal: "broken: or mangled:",
        action: "白名单内机械修复，双绿后推送分支并创建 loop(docs): PR",
        evidenceRequired: ["发现清单", "修复方式", "预算消耗"],
      },
      {
        signal: "landed: or promote: or artifact:",
        action: "创建 [loop-adjudication] issue，不修改",
        evidenceRequired: ["证据清单", "建议裁决问题"],
      },
      {
        signal: "budget exceeded",
        action: "立即停止并创建现场 issue，追加 budget-exceeded 日志",
        evidenceRequired: ["已完成", "未完成"],
      },
    ],
    budget: { maxDurationMinutes: 30, maxToolCalls: 200 },
    safety: {
      protectedBranches: ["main", "master"],
      allowedPaths: ["docs/**", ".agents/**"],
      forbiddenActions: ["merge", "tag", "push-main", "write-outside-allowlist"],
      cleanupPolicy: "no-pr-delete-branch-and-worktree; pr-open-keep-branch-remove-worktree",
    },
  },
};

export function templates() {
  return [docsLifecycleTemplate];
}
