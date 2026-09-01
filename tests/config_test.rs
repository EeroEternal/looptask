use looptask::{
    ProjectConfig,
    celld::{ArtifactPlacement, agent_cell_id, artifact_placement, foundation},
};

#[test]
fn example_config_loads_and_validates() {
    let config = ProjectConfig::from_path("examples/looptask.json").unwrap();

    assert_eq!(config.project.name, "looptask");
    assert_eq!(config.project.loops.len(), 3);
    assert_eq!(config.project.celld.durable_object_class, "AgentCell");
}

#[test]
fn celld_foundation_keeps_untrusted_execution_outside_cells() {
    let config = ProjectConfig::from_path("examples/looptask.json").unwrap();
    let runtime = foundation(&config.project);

    assert!(
        runtime
            .sandbox_boundary
            .warning
            .contains("not a hostile multi-tenant sandbox")
    );
    assert!(
        runtime
            .sandbox_boundary
            .external_sandbox_handles
            .contains(&"untrusted code execution".to_string())
    );
}

#[test]
fn agent_cell_id_uses_project_loop_and_agent() {
    let config = ProjectConfig::from_path("examples/looptask.json").unwrap();
    let loop_def = &config.project.loops[0];

    assert_eq!(
        agent_cell_id(&config.project, loop_def, "docs"),
        "looptask/docs-sync/docs"
    );
}

#[test]
fn large_or_cold_artifacts_go_to_object_storage() {
    assert_eq!(
        artifact_placement(10, true, false),
        ArtifactPlacement::CellSqlite
    );
    assert_eq!(
        artifact_placement(1024 * 1024, true, false),
        ArtifactPlacement::ObjectStorage
    );
    assert_eq!(
        artifact_placement(10, false, false),
        ArtifactPlacement::ObjectStorage
    );
}
