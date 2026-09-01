use axum::{
    Json, Router,
    extract::Path,
    routing::{get, post},
};
use looptask::celld::{ArtifactRecord, CelldClient, InboxEvent};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// Spawns a minimal mock of `celld/src/worker.js` + `AgentCell` that records
/// which single path segment it was addressed with, so tests can assert that
/// multi-segment agent cell IDs (e.g. `looptask/docs-sync/docs`) are sent as
/// one percent-encoded segment rather than split across the URL path.
async fn spawn_mock_celld() -> (String, std::sync::Arc<Mutex<Vec<String>>>) {
    let seen_ids = std::sync::Arc::new(Mutex::new(Vec::new()));

    let state_ids = seen_ids.clone();
    let inbox_ids = seen_ids.clone();
    let artifact_ids = seen_ids.clone();

    let app = Router::new()
        .route(
            "/agents/{id}/state",
            get(move |Path(id): Path<String>| {
                let seen_ids = state_ids.clone();
                async move {
                    seen_ids.lock().await.push(id);
                    Json(json!({ "inbox": 2, "tasks": 1, "artifacts": 3 }))
                }
            }),
        )
        .route(
            "/agents/{id}/inbox",
            post(move |Path(id): Path<String>, Json(body): Json<Value>| {
                let seen_ids = inbox_ids.clone();
                async move {
                    seen_ids.lock().await.push(id);
                    let generated_id = body
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("evt-generated")
                        .to_string();
                    Json(json!({ "accepted": true, "id": generated_id }))
                }
            }),
        )
        .route(
            "/agents/{id}/artifacts",
            post(move |Path(id): Path<String>, Json(_body): Json<Value>| {
                let seen_ids = artifact_ids.clone();
                async move {
                    seen_ids.lock().await.push(id);
                    Json(json!({ "recorded": true, "id": "artifact-1" }))
                }
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (format!("http://{addr}"), seen_ids)
}

#[tokio::test]
async fn cell_state_round_trips_through_http() {
    let (base_url, seen_ids) = spawn_mock_celld().await;
    let client = CelldClient::new(base_url).unwrap();

    let state = client.cell_state("looptask/docs-sync/docs").await.unwrap();

    assert_eq!(state.inbox, 2);
    assert_eq!(state.tasks, 1);
    assert_eq!(state.artifacts, 3);
    assert_eq!(
        seen_ids.lock().await.as_slice(),
        ["looptask/docs-sync/docs"],
        "multi-segment cell id must reach celld as a single decoded id, matching worker.js's single-segment route"
    );
}

#[tokio::test]
async fn enqueue_inbox_sends_event_and_returns_ack() {
    let (base_url, seen_ids) = spawn_mock_celld().await;
    let client = CelldClient::new(base_url).unwrap();

    let event = InboxEvent {
        id: Some("evt-42".to_string()),
        source: "looptask-dispatch".to_string(),
        body: json!({ "loop": "docs-sync" }),
        wake_at: None,
    };

    let ack = client
        .enqueue_inbox("looptask/docs-sync/docs", &event)
        .await
        .unwrap();

    assert!(ack.accepted);
    assert_eq!(ack.id, "evt-42");
    assert_eq!(
        seen_ids.lock().await.as_slice(),
        ["looptask/docs-sync/docs"]
    );
}

#[tokio::test]
async fn record_artifact_sends_metadata_and_returns_ack() {
    let (base_url, seen_ids) = spawn_mock_celld().await;
    let client = CelldClient::new(base_url).unwrap();

    let artifact = ArtifactRecord {
        id: None,
        kind: "patch".to_string(),
        storage_uri: "r2://agents/docs/artifacts/patch-1".to_string(),
        sha256: None,
        bytes: 1024,
        preview: None,
    };

    let ack = client
        .record_artifact("looptask/docs-sync/docs", &artifact)
        .await
        .unwrap();

    assert!(ack.recorded);
    assert_eq!(
        seen_ids.lock().await.as_slice(),
        ["looptask/docs-sync/docs"]
    );
}

#[tokio::test]
async fn cell_state_reports_celld_error_on_non_success_status() {
    let app = Router::new().route(
        "/agents/{id}/state",
        get(|| async { (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "boom") }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let client = CelldClient::new(format!("http://{addr}")).unwrap();
    let error = client.cell_state("looptask/docs-sync/docs").await;

    assert!(error.is_err());
}
