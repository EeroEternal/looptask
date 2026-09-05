use std::{env, time::Duration};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repository {
    pub owner: String,
    pub name: String,
}

pub fn parse_repository(value: &str) -> Result<Repository> {
    let url = Url::parse(value.trim()).map_err(|_| {
        Error::Config("repository must be https://github.com/{owner}/{repo}".to_string())
    })?;
    if url.scheme() != "https"
        || !url
            .host_str()
            .is_some_and(|host| host.eq_ignore_ascii_case("github.com"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Config(
            "repository must be https://github.com/{owner}/{repo}".to_string(),
        ));
    }
    if url.path().ends_with('/') {
        return Err(Error::Config(
            "repository must be https://github.com/{owner}/{repo}".to_string(),
        ));
    }
    let segments: Vec<_> = url
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).collect())
        .unwrap_or_default();
    if segments.len() != 2 {
        return Err(Error::Config(
            "repository must be https://github.com/{owner}/{repo}".to_string(),
        ));
    }
    let owner = segments[0];
    let name = segments[1].strip_suffix(".git").unwrap_or(segments[1]);
    if !valid_component(owner) || !valid_component(name) {
        return Err(Error::Config(
            "repository owner and name contain invalid characters".to_string(),
        ));
    }
    Ok(Repository {
        owner: owner.to_string(),
        name: name.to_string(),
    })
}

fn valid_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value.len() <= 100
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: i32,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepository {
    #[serde(rename(serialize = "fullName", deserialize = "full_name"))]
    pub full_name: String,
    #[serde(rename(serialize = "htmlUrl", deserialize = "html_url"))]
    pub html_url: String,
    #[serde(rename(serialize = "defaultBranch", deserialize = "default_branch"))]
    pub default_branch: String,
    pub private: bool,
    #[serde(skip_serializing, default)]
    permissions: Option<RepositoryPermissions>,
    #[serde(default)]
    pub can_push: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RepositoryPermissions {
    #[serde(default)]
    push: bool,
}

#[derive(Deserialize)]
struct Branch {
    commit: BranchCommit,
}

#[derive(Deserialize)]
struct BranchCommit {
    sha: String,
}

#[derive(Clone)]
pub struct GitHubClient {
    http: Client,
    base: Url,
    token: String,
    allowed_repositories: Vec<Repository>,
}

impl GitHubClient {
    pub fn from_env() -> Result<Self> {
        let token = env::var("GITHUB_TOKEN").map_err(|_| {
            Error::Config("GITHUB_TOKEN is required to create pull requests".to_string())
        })?;
        let allowed_repositories = parse_allowed_repositories(
            &env::var("LOOPTASK_GITHUB_ALLOWED_REPOSITORIES").unwrap_or_default(),
        )?;
        let base =
            env::var("GITHUB_API_BASE").unwrap_or_else(|_| "https://api.github.com/".to_string());
        Self::new_with_allowed(base, token, allowed_repositories)
    }

    pub fn new(base: impl AsRef<str>, token: String) -> Result<Self> {
        Self::new_with_allowed(base, token, Vec::new())
    }

    pub fn new_with_allowed(
        base: impl AsRef<str>,
        token: String,
        allowed_repositories: Vec<Repository>,
    ) -> Result<Self> {
        let mut base = Url::parse(base.as_ref())
            .map_err(|_| Error::Config("invalid GitHub API base URL".to_string()))?;
        if base.scheme() != "https"
            && base.host_str() != Some("127.0.0.1")
            && base.host_str() != Some("localhost")
        {
            return Err(Error::Config("GitHub API base must use HTTPS".to_string()));
        }
        if !base.path().ends_with('/') {
            base.set_path(&format!("{}/", base.path()));
        }
        let http = Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| Error::Internal(anyhow::anyhow!(e)))?;
        Ok(Self {
            http,
            base,
            token,
            allowed_repositories,
        })
    }

    pub fn ensure_repository_allowed(&self, repository: &Repository) -> Result<()> {
        if self.allowed_repositories.is_empty()
            || !self.allowed_repositories.iter().any(|allowed| {
                allowed.owner.eq_ignore_ascii_case(&repository.owner)
                    && allowed.name.eq_ignore_ascii_case(&repository.name)
            })
        {
            return Err(Error::Config(
                "repository is not allowed by LOOPTASK_GITHUB_ALLOWED_REPOSITORIES".to_string(),
            ));
        }
        Ok(())
    }

    pub async fn accessible_repositories(&self) -> Result<Vec<GitHubRepository>> {
        let mut repositories = Vec::new();
        for repository in &self.allowed_repositories {
            if let Some(repository) = self.repository_metadata(repository).await? {
                repositories.push(repository);
            }
        }
        Ok(repositories)
    }

    async fn repository_metadata(
        &self,
        repository: &Repository,
    ) -> Result<Option<GitHubRepository>> {
        self.ensure_repository_allowed(repository)?;
        let endpoint = self
            .base
            .join(&format!("repos/{}/{}", repository.owner, repository.name))
            .map_err(|e| Error::Internal(anyhow::anyhow!(e)))?;
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(&self.token)
            .header("user-agent", "looptask-control-plane")
            .send()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("GitHub request failed: {e}")))?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return github_error(response).await.map(Some);
        }
        let mut metadata: GitHubRepository = response
            .json()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("invalid GitHub response: {e}")))?;
        metadata.can_push = metadata
            .permissions
            .as_ref()
            .is_some_and(|permissions| permissions.push);
        Ok(Some(metadata))
    }

    pub async fn create_or_find_pr(
        &self,
        repo: &Repository,
        head: &str,
        base: &str,
        title: &str,
        body: &str,
    ) -> Result<PullRequest> {
        self.ensure_repository_allowed(repo)?;
        if !valid_branch(head) || !valid_branch(base) {
            return Err(Error::Config("invalid Git branch name".to_string()));
        }
        let endpoint = self
            .base
            .join(&format!("repos/{}/{}/pulls", repo.owner, repo.name))
            .map_err(|e| Error::Internal(anyhow::anyhow!(e)))?;
        let response = self
            .http
            .get(endpoint.clone())
            .bearer_auth(&self.token)
            .header("user-agent", "looptask-control-plane")
            .query(&[
                ("state", "open"),
                ("head", &format!("{}:{head}", repo.owner)),
                ("base", base),
            ])
            .send()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("GitHub request failed: {e}")))?;
        if !response.status().is_success() {
            return github_error(response).await;
        }
        let existing: Vec<PullRequest> = response
            .json()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("invalid GitHub response: {e}")))?;
        if let Some(pr) = existing.into_iter().next() {
            return Ok(pr);
        }
        let response = self
            .http
            .post(endpoint)
            .bearer_auth(&self.token)
            .header("user-agent", "looptask-control-plane")
            .json(&serde_json::json!({"title": title, "head": head, "base": base, "body": body}))
            .send()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("GitHub request failed: {e}")))?;
        if !response.status().is_success() {
            return github_error(response).await;
        }
        response
            .json()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("invalid GitHub response: {e}")))
    }

    pub async fn verify_branch_sha(
        &self,
        repo: &Repository,
        branch: &str,
        expected_sha: &str,
    ) -> Result<()> {
        if !valid_branch(branch) {
            return Err(Error::Config("invalid Git branch name".to_string()));
        }
        let mut endpoint = self.base.clone();
        {
            let mut segments = endpoint.path_segments_mut().map_err(|_| {
                Error::Config("GitHub API base must support path segments".to_string())
            })?;
            segments
                .pop_if_empty()
                .push("repos")
                .push(&repo.owner)
                .push(&repo.name)
                .push("branches")
                .push(branch);
        }
        let response = self
            .http
            .get(endpoint)
            .bearer_auth(&self.token)
            .header("user-agent", "looptask-control-plane")
            .send()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("GitHub request failed: {e}")))?;
        if !response.status().is_success() {
            return github_error(response).await;
        }
        let actual: Branch = response
            .json()
            .await
            .map_err(|e| Error::Internal(anyhow::anyhow!("invalid GitHub response: {e}")))?;
        if !actual.commit.sha.eq_ignore_ascii_case(expected_sha) {
            return Err(Error::Config(
                "executor headSha does not match the GitHub branch head".to_string(),
            ));
        }
        Ok(())
    }
}

pub fn parse_allowed_repositories(value: &str) -> Result<Vec<Repository>> {
    let repositories: Vec<_> = value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| {
            let parts: Vec<_> = item.split('/').collect();
            if parts.len() != 2 || !valid_component(parts[0]) || !valid_component(parts[1]) {
                return Err(Error::Config(
                    "LOOPTASK_GITHUB_ALLOWED_REPOSITORIES must contain exact owner/repo entries"
                        .to_string(),
                ));
            }
            Ok(Repository {
                owner: parts[0].to_string(),
                name: parts[1].to_string(),
            })
        })
        .collect::<Result<_>>()?;
    if repositories.is_empty() {
        return Err(Error::Config(
            "LOOPTASK_GITHUB_ALLOWED_REPOSITORIES must not be empty".to_string(),
        ));
    }
    Ok(repositories)
}

async fn github_error<T>(response: reqwest::Response) -> Result<T> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(Error::Internal(anyhow::anyhow!(
        "GitHub API responded with {status}: {body}"
    )))
}

pub fn valid_branch(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('/')
        && !value.ends_with('/')
        && !value.contains("..")
        && !value.contains("@{")
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'/' | b'-' | b'_' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::{GitHubClient, PullRequest, parse_allowed_repositories, parse_repository};
    use axum::{Json, Router, routing::get};
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::net::TcpListener;
    #[test]
    fn parses_strict_github_urls() {
        assert_eq!(
            parse_repository("https://github.com/acme/widget.git")
                .unwrap()
                .name,
            "widget"
        );
        assert!(parse_repository("git@github.com:acme/widget.git").is_err());
        assert!(parse_repository("https://github.com/acme/widget/issues").is_err());
        assert!(parse_repository("https://evil.example/acme/widget").is_err());
    }

    #[test]
    fn allowlist_accepts_only_exact_repository() {
        let allowed = parse_allowed_repositories("Acme/widget,other/repo").unwrap();
        let client =
            GitHubClient::new_with_allowed("http://localhost:9999", "token".to_string(), allowed)
                .unwrap();
        assert!(
            client
                .ensure_repository_allowed(
                    &parse_repository("https://github.com/acme/WIDGET").unwrap()
                )
                .is_ok()
        );
        assert!(
            client
                .ensure_repository_allowed(
                    &parse_repository("https://github.com/acme/other").unwrap()
                )
                .is_err()
        );
        assert!(parse_allowed_repositories("").is_err());
    }

    #[tokio::test]
    async fn creates_pr_against_injectable_api_base() {
        let creates = Arc::new(AtomicUsize::new(0));
        let counter = creates.clone();
        let app = Router::new().route(
            "/repos/acme/widget/pulls",
            get(|| async { Json(Vec::<PullRequest>::new()) }).post(move || {
                let counter = counter.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Json(PullRequest {
                        number: 12,
                        html_url: "https://github.com/acme/widget/pull/12".to_string(),
                    })
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = GitHubClient::new_with_allowed(
            format!("http://{address}"),
            "not-logged".to_string(),
            vec![parse_repository("https://github.com/acme/widget").unwrap()],
        )
        .unwrap();
        let repository = parse_repository("https://github.com/acme/widget").unwrap();
        let pr = client
            .create_or_find_pr(&repository, "agent/change", "main", "task", "summary")
            .await
            .unwrap();
        assert_eq!(pr.number, 12);
        assert_eq!(creates.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn lists_only_accessible_repositories_with_permissions() {
        let app = Router::new()
            .route(
                "/repos/acme/writable",
                get(|| async {
                    Json(serde_json::json!({
                        "full_name":"acme/writable", "html_url":"https://github.com/acme/writable",
                        "default_branch":"trunk", "private":true, "permissions":{"push":true}
                    }))
                }),
            )
            .route(
                "/repos/acme/missing",
                get(|| async { axum::http::StatusCode::NOT_FOUND }),
            );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = GitHubClient::new_with_allowed(
            format!("http://{address}"),
            "token".to_string(),
            parse_allowed_repositories("acme/writable,acme/missing").unwrap(),
        )
        .unwrap();
        let repositories = client.accessible_repositories().await.unwrap();
        assert_eq!(repositories.len(), 1);
        assert_eq!(repositories[0].default_branch, "trunk");
        assert!(repositories[0].can_push);
        let json = serde_json::to_value(&repositories[0]).unwrap();
        assert_eq!(json["canPush"], true);
        assert!(json.get("permissions").is_none());
    }
}
