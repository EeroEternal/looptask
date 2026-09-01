use axum::{
    Json, Router,
    body::Body,
    extract::Path,
    http::{Request, StatusCode},
    routing::post,
};
use http_body_util::BodyExt;
use looptask::{ProjectConfig, server::create_router};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tower::ServiceExt;

#[tokio::test]
async fn health_check_reports_rust_runtime() {
    let app = create_router();

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["status"], "ok");
    assert_eq!(json["service"], "looptask");
    assert_eq!(json["runtime"], "rust");
}

/// Spawns a minimal mock of the celld worker's inbox endpoint used to verify
/// the Rust service actually dispatches a loop over HTTP.
async fn spawn_mock_celld_inbox() -> String {
    let app = Router::new().route(
        "/agents/{id}/inbox",
        post(|Path(_id): Path<String>, Json(_body): Json<Value>| async {
            Json(json!({ "accepted": true, "id": "evt-dispatch-1" }))
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn dispatch_loop_enqueues_into_celld_inbox() {
    let celld_url = spawn_mock_celld_inbox().await;
    let mut config = ProjectConfig::from_path("examples/looptask.json").unwrap();
    config.project.celld.internal_url = Some(celld_url);

    let request_body = json!({
        "project": config.project,
        "loopName": "docs-sync",
        "agentKey": "docs",
    });

    let app = create_router();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/loops/dispatch")
                .header("content-type", "application/json")
                .body(Body::from(request_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["accepted"], true);
    assert_eq!(json["dispatch"]["accepted"], true);
    assert_eq!(json["dispatch"]["id"], "evt-dispatch-1");
    assert_eq!(json["loopPlan"]["agentCellId"], "looptask/docs-sync/docs");
}

#[tokio::test]
async fn dispatch_loop_rejects_unknown_loop_name() {
    let config = ProjectConfig::from_path("examples/looptask.json").unwrap();

    let request_body = json!({
        "project": config.project,
        "loopName": "does-not-exist",
    });

    let app = create_router();
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/loops/dispatch")
                .header("content-type", "application/json")
                .body(Body::from(request_body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["accepted"], false);
    assert!(json["loopPlan"].is_null());
    assert!(json["dispatch"].is_null());
}
