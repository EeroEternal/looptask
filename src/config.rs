use std::{env, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::{Error, Result, models::Project};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host: env::var("LOOPTASK_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("LOOPTASK_PORT")
                .or_else(|_| env::var("PORT"))
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(8080),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite::memory:".to_string()),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self::from_env()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub project: Project,
}

impl ProjectConfig {
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let content = fs::read_to_string(path).map_err(|error| {
            Error::Config(format!("failed to read {}: {error}", path.display()))
        })?;
        let config: Self = serde_json::from_str(&content).map_err(|error| {
            Error::Config(format!("invalid JSON in {}: {error}", path.display()))
        })?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.project.name.trim().is_empty() {
            return Err(Error::Config("project.name is required".to_string()));
        }
        if self.project.loops.is_empty() {
            return Err(Error::Config("project.loops must not be empty".to_string()));
        }
        for loop_def in &self.project.loops {
            if loop_def.name.trim().is_empty() {
                return Err(Error::Config("loop.name is required".to_string()));
            }
            if loop_def.goal.trim().is_empty() {
                return Err(Error::Config(format!(
                    "loop.goal is required for {}",
                    loop_def.name
                )));
            }
        }
        Ok(())
    }
}
