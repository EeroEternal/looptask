use looptask::{Config, error::Result, server};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let app = server::create_router();
    let addr = format!("{}:{}", config.host, config.port);

    info!("starting looptask server on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|err| anyhow::anyhow!("failed to bind to {addr}: {err}"))?;

    axum::serve(listener, app)
        .await
        .map_err(|err| anyhow::anyhow!("server error: {err}"))?;

    Ok(())
}
