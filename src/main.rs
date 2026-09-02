use looptask::{Config, server};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::env;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    if config.database_url.trim().is_empty() {
        return Err(anyhow::anyhow!(
            "DATABASE_URL is required for the production server"
        ));
    }
    let pool: PgPool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await
        .map_err(|error| anyhow::anyhow!("failed to connect to PostgreSQL: {error}"))?;
    if env::var("LOOPTASK_SKIP_MIGRATIONS").as_deref() == Ok("true") {
        info!("skipping runtime database migrations in the published environment");
    } else {
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|error| anyhow::anyhow!("failed to apply database migrations: {error}"))?;
    }
    let app = server::create_router_with_database(pool);
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
