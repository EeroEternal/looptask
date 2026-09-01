use std::{collections::HashMap, env, sync::Arc};

use chrono::{DateTime, Duration, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{Error, Result};

const CODE_TTL_MINUTES: i64 = 10;
const SESSION_TTL_DAYS: i64 = 30;
const MAX_CODE_ATTEMPTS: u8 = 5;

#[derive(Clone, Default)]
pub struct AuthState {
    inner: Arc<RwLock<AuthStore>>,
}

#[derive(Default)]
struct AuthStore {
    users: HashMap<String, User>,
    pending_codes: HashMap<String, PendingCode>,
    sessions: HashMap<String, Session>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct User {
    id: Uuid,
    email: String,
    display_name: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct PendingCode {
    code_hash: String,
    purpose: AuthPurpose,
    display_name: String,
    expires_at: DateTime<Utc>,
    attempts: u8,
}

#[derive(Debug, Clone)]
struct Session {
    user_id: Uuid,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthPurpose {
    #[default]
    Register,
    Login,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeRequest {
    pub email: String,
    #[serde(default)]
    pub purpose: AuthPurpose,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeVerification {
    pub email: String,
    pub code: String,
    #[serde(default)]
    pub purpose: AuthPurpose,
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeResponse {
    pub accepted: bool,
    pub message: String,
    pub expires_in_seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
    pub authenticated: bool,
    pub user: Option<PublicUser>,
}

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user: PublicUser,
}

impl AuthState {
    pub async fn request_code(&self, request: &CodeRequest) -> Result<CodeResponse> {
        let email = normalize_email(&request.email)?;
        let display_name = normalize_display_name(&request.display_name, &email);
        let mut store = self.inner.write().await;

        if matches!(request.purpose, AuthPurpose::Register) && store.users.contains_key(&email) {
            return Err(Error::Config(
                "该邮箱已经注册，请切换到登录或使用其他邮箱".to_string(),
            ));
        }
        if matches!(request.purpose, AuthPurpose::Login) && !store.users.contains_key(&email) {
            return Err(Error::Config("该邮箱尚未注册，请先完成注册".to_string()));
        }

        let code = format!("{:06}", (Uuid::new_v4().as_u128() % 1_000_000) as u32);
        let expires_at = Utc::now() + Duration::minutes(CODE_TTL_MINUTES);
        let pending = PendingCode {
            code_hash: hash_code(&email, &code),
            purpose: request.purpose,
            display_name,
            expires_at,
            attempts: 0,
        };
        store.pending_codes.insert(email.clone(), pending);
        drop(store);

        EmailSender::from_env()?.send_code(&email, &code).await?;
        Ok(CodeResponse {
            accepted: true,
            message: "验证码已发送，请检查邮箱".to_string(),
            expires_in_seconds: CODE_TTL_MINUTES * 60,
        })
    }

    pub async fn verify_code(&self, request: &CodeVerification) -> Result<(PublicUser, String)> {
        let email = normalize_email(&request.email)?;
        let mut store = self.inner.write().await;
        let pending = store
            .pending_codes
            .get_mut(&email)
            .ok_or_else(|| Error::Config("验证码不存在或已失效，请重新发送".to_string()))?;

        if pending.expires_at < Utc::now() {
            store.pending_codes.remove(&email);
            return Err(Error::Config("验证码已过期，请重新发送".to_string()));
        }
        if pending.attempts >= MAX_CODE_ATTEMPTS {
            store.pending_codes.remove(&email);
            return Err(Error::Config("验证码尝试次数过多，请重新发送".to_string()));
        }
        pending.attempts += 1;
        if pending.code_hash != hash_code(&email, &request.code) {
            return Err(Error::Config("验证码不正确".to_string()));
        }
        let pending = store
            .pending_codes
            .remove(&email)
            .expect("pending code exists");

        let user = match pending.purpose {
            AuthPurpose::Register => {
                let user = User {
                    id: Uuid::new_v4(),
                    email: email.clone(),
                    display_name: if request.display_name.trim().is_empty() {
                        pending.display_name
                    } else {
                        normalize_display_name(&request.display_name, &email)
                    },
                    created_at: Utc::now(),
                };
                store.users.insert(email, user.clone());
                user
            }
            AuthPurpose::Login => store
                .users
                .get(&email)
                .cloned()
                .ok_or_else(|| Error::Config("用户不存在，请先注册".to_string()))?,
        };
        let session_id = Uuid::new_v4().to_string();
        store.sessions.insert(
            session_id.clone(),
            Session {
                user_id: user.id,
                expires_at: Utc::now() + Duration::days(SESSION_TTL_DAYS),
            },
        );
        Ok((public_user(&user), session_id))
    }

    pub async fn session_user(&self, session_id: Option<&str>) -> Option<AuthenticatedUser> {
        let session_id = session_id?;
        let mut store = self.inner.write().await;
        let session = store.sessions.get(session_id)?.clone();
        if session.expires_at < Utc::now() {
            store.sessions.remove(session_id);
            return None;
        }
        let user = store
            .users
            .values()
            .find(|user| user.id == session.user_id)
            .cloned()?;
        Some(AuthenticatedUser {
            user: public_user(&user),
        })
    }

    pub async fn remove_session(&self, session_id: Option<&str>) {
        if let Some(session_id) = session_id {
            self.inner.write().await.sessions.remove(session_id);
        }
    }
}

#[derive(Clone)]
pub struct EmailSender {
    client: Client,
    account_id: String,
    api_token: String,
    from: String,
}

impl EmailSender {
    pub fn from_env() -> Result<Self> {
        let account_id = env::var("CLOUDFLARE_ACCOUNT_ID").map_err(|_| {
            Error::Config(
                "邮件服务未配置 CLOUDFLARE_ACCOUNT_ID，请在 Replit Secrets 中添加".to_string(),
            )
        })?;
        let api_token = env::var("CLOUDFLARE_API_TOKEN").map_err(|_| {
            Error::Config(
                "邮件服务未配置 CLOUDFLARE_API_TOKEN，请在 Replit Secrets 中添加".to_string(),
            )
        })?;
        let from = env::var("LOOPTASK_EMAIL_FROM").map_err(|_| {
            Error::Config("邮件服务未配置 LOOPTASK_EMAIL_FROM，请设置已验证的发件地址".to_string())
        })?;
        let client = Client::builder()
            .build()
            .map_err(|error| Error::Internal(anyhow::anyhow!(error)))?;
        Ok(Self {
            client,
            account_id,
            api_token,
            from,
        })
    }

    async fn send_code(&self, recipient: &str, code: &str) -> Result<()> {
        let endpoint = format!(
            "https://api.cloudflare.com/client/v4/accounts/{}/email/sending/send",
            self.account_id
        );
        let response = self
            .client
            .post(endpoint)
            .bearer_auth(&self.api_token)
            .json(&serde_json::json!({
                "to": recipient,
                "from": self.from,
                "subject": "looptask 验证码",
                "text": format!("你的 looptask 验证码是 {}，10 分钟内有效。", code),
                "html": format!("<p>你的 looptask 验证码是：</p><h1>{}</h1><p>验证码 10 分钟内有效。</p>", code),
            }))
            .send()
            .await
            .map_err(|error| Error::Internal(anyhow::anyhow!("Cloudflare 邮件请求失败: {error}")))?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Error::Config(format!(
                "Cloudflare 邮件发送失败（{}）：{}",
                status,
                cloudflare_error_message(&body)
            )));
        }
        let payload: serde_json::Value = serde_json::from_str(&body).map_err(|error| {
            Error::Internal(anyhow::anyhow!("Cloudflare 返回无效 JSON: {error}"))
        })?;
        if payload["success"].as_bool() != Some(true) {
            return Err(Error::Config(format!(
                "Cloudflare 邮件发送未确认成功：{}",
                cloudflare_error_message(&body)
            )));
        }
        Ok(())
    }
}

fn cloudflare_error_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|json| json["errors"].as_array().cloned())
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error["message"].as_str())
                .collect::<Vec<_>>()
                .join("; ")
        })
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| "未知错误".to_string())
}

fn normalize_email(value: &str) -> Result<String> {
    let email = value.trim().to_lowercase();
    let valid = email.len() >= 5
        && email.len() <= 254
        && email.contains('@')
        && email
            .rsplit('@')
            .next()
            .is_some_and(|domain| domain.contains('.'));
    if !valid {
        return Err(Error::Config("请输入有效的邮箱地址".to_string()));
    }
    Ok(email)
}

fn normalize_display_name(value: &str, email: &str) -> String {
    let value = value.trim();
    if !value.is_empty() {
        return value.chars().take(40).collect();
    }
    email.split('@').next().unwrap_or("operator").to_string()
}

fn hash_code(email: &str, code: &str) -> String {
    let secret =
        env::var("SESSION_SECRET").unwrap_or_else(|_| "looptask-local-session".to_string());
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b":");
    hasher.update(email.as_bytes());
    hasher.update(b":");
    hasher.update(code.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn public_user(user: &User) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        created_at: user.created_at,
    }
}
