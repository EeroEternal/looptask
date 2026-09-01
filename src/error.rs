use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            Error::NotFound(message) => (StatusCode::NOT_FOUND, message.clone()),
            Error::Config(message) => (StatusCode::BAD_REQUEST, message.clone()),
            Error::Database(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Error::Internal(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        };

        let body = Json(json!({
            "error": {
                "message": message,
                "code": status.as_u16()
            }
        }));

        (status, body).into_response()
    }
}
