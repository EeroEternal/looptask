use std::{
    collections::HashMap,
    env,
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sqlx::{FromRow, PgPool};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{Error, Result};

const CODE_TTL_MINUTES: i64 = 10;
const SESSION_TTL_DAYS: i64 = 30;
const MAX_CODE_ATTEMPTS: i32 = 5;
const CODE_COOLDOWN_SECONDS: i64 = 60;
type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct AuthState {
    inner: Arc<RwLock<AuthStore>>,
    pool: Option<PgPool>,
    mailer: Mailer,
}

#[derive(Clone)]
enum Mailer {
    Cloudflare,
    Test(Arc<Mutex<Option<String>>>),
}

impl Default for AuthState {
    fn default() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AuthStore::default())),
            pool: None,
            mailer: Mailer::Test(Arc::new(Mutex::new(None))),
        }
    }
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
    attempts: i32,
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

#[derive(Debug, FromRow)]
struct DbUser {
    id: Uuid,
    email: String,
    display_name: String,
    created_at: DateTime<Utc>,
}

#[derive(Debug, FromRow)]
struct DbChallenge {
    id: Uuid,
    purpose: String,
    code_hash: String,
    display_name: String,
    expires_at: DateTime<Utc>,
    attempts: i32,
}

#[derive(Debug, FromRow)]
struct DbSessionUser {
    id: Uuid,
    email: String,
    display_name: String,
    created_at: DateTime<Utc>,
}

impl AuthState {
    pub fn from_pool(pool: PgPool) -> Self {
        Self {
            inner: Arc::new(RwLock::new(AuthStore::default())),
            pool: Some(pool),
            mailer: Mailer::Cloudflare,
        }
    }

    pub async fn request_code(
        &self,
        request: &CodeRequest,
        request_ip: Option<&str>,
    ) -> Result<CodeResponse> {
        if let Some(pool) = &self.pool {
            return self.request_code_db(pool, request, request_ip).await;
        }

        self.request_code_memory(request).await
    }

    async fn request_code_db(
        &self,
        pool: &PgPool,
        request: &CodeRequest,
        request_ip: Option<&str>,
    ) -> Result<CodeResponse> {
        let email = normalize_email(&request.email)?;
        let display_name = normalize_display_name(&request.display_name, &email);
        let registered: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)")
                .bind(&email)
                .fetch_one(pool)
                .await?;

        if matches!(request.purpose, AuthPurpose::Register) && registered {
            return Err(Error::Config(
                "该邮箱已经注册，请切换到登录或使用其他邮箱".to_string(),
            ));
        }

        let recent: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT created_at
             FROM auth_challenges
             WHERE email = $1
               AND created_at > NOW() - ($2 * INTERVAL '1 second')
             ORDER BY created_at DESC
             LIMIT 1",
        )
        .bind(&email)
        .bind(CODE_COOLDOWN_SECONDS)
        .fetch_optional(pool)
        .await?;
        if recent.is_some() {
            return Err(Error::Config("验证码发送过于频繁，请稍后再试".to_string()));
        }

        let code = generate_code();
        let challenge_id = Uuid::new_v4();
        let expires_at = Utc::now() + Duration::minutes(CODE_TTL_MINUTES);
        sqlx::query(
            "INSERT INTO auth_challenges
                (id, email, purpose, code_hash, display_name, expires_at, request_ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(challenge_id)
        .bind(&email)
        .bind(purpose_name(request.purpose))
        .bind(hash_code(&email, &code))
        .bind(&display_name)
        .bind(expires_at)
        .bind(request_ip)
        .execute(pool)
        .await?;

        if let Err(error) = self.send_code(&email, &code).await {
            let _ = sqlx::query("DELETE FROM auth_challenges WHERE id = $1")
                .bind(challenge_id)
                .execute(pool)
                .await;
            return Err(error);
        }

        Ok(CodeResponse {
            accepted: true,
            message: "验证码已发送，请检查邮箱".to_string(),
            expires_in_seconds: CODE_TTL_MINUTES * 60,
        })
    }

    async fn request_code_memory(&self, request: &CodeRequest) -> Result<CodeResponse> {
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

        let code = generate_code();
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

        self.send_code(&email, &code).await?;
        Ok(CodeResponse {
            accepted: true,
            message: "验证码已发送，请检查邮箱".to_string(),
            expires_in_seconds: CODE_TTL_MINUTES * 60,
        })
    }

    pub async fn verify_code(&self, request: &CodeVerification) -> Result<(PublicUser, String)> {
        if let Some(pool) = &self.pool {
            return self.verify_code_db(pool, request).await;
        }

        self.verify_code_memory(request).await
    }

    async fn verify_code_db(
        &self,
        pool: &PgPool,
        request: &CodeVerification,
    ) -> Result<(PublicUser, String)> {
        let email = normalize_email(&request.email)?;
        let mut tx = pool.begin().await?;
        let pending = sqlx::query_as::<_, DbChallenge>(
            "SELECT id, purpose, code_hash, display_name, expires_at, attempts
             FROM auth_challenges
             WHERE email = $1 AND consumed_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
             FOR UPDATE",
        )
        .bind(&email)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| Error::Config("验证码不存在或已失效，请重新发送".to_string()))?;

        if pending.expires_at < Utc::now() {
            consume_challenge(&mut tx, pending.id).await?;
            tx.commit().await?;
            return Err(Error::Config("验证码已过期，请重新发送".to_string()));
        }
        if pending.attempts >= MAX_CODE_ATTEMPTS {
            consume_challenge(&mut tx, pending.id).await?;
            tx.commit().await?;
            return Err(Error::Config("验证码尝试次数过多，请重新发送".to_string()));
        }

        let next_attempts = pending.attempts + 1;
        if pending.code_hash != hash_code(&email, &request.code) {
            sqlx::query(
                "UPDATE auth_challenges
                 SET attempts = $2,
                     consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END
                 WHERE id = $1",
            )
            .bind(pending.id)
            .bind(next_attempts)
            .bind(MAX_CODE_ATTEMPTS)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Err(if next_attempts >= MAX_CODE_ATTEMPTS {
                Error::Config("验证码尝试次数过多，请重新发送".to_string())
            } else {
                Error::Config("验证码不正确".to_string())
            });
        }

        consume_challenge(&mut tx, pending.id).await?;
        let user = match pending.purpose.as_str() {
            "register" => {
                let display_name = if request.display_name.trim().is_empty() {
                    pending.display_name
                } else {
                    normalize_display_name(&request.display_name, &email)
                };
                sqlx::query_as::<_, DbUser>(
                    "INSERT INTO users (id, email, display_name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (email) DO NOTHING
                     RETURNING id, email, display_name, created_at",
                )
                .bind(Uuid::new_v4())
                .bind(&email)
                .bind(display_name)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| Error::Config("该邮箱已经注册，请切换到登录".to_string()))?
            }
            "login" => sqlx::query_as::<_, DbUser>(
                "SELECT id, email, display_name, created_at
                 FROM users
                 WHERE email = $1",
            )
            .bind(&email)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| Error::Config("用户不存在，请先完成注册".to_string()))?,
            _ => {
                tx.rollback().await?;
                return Err(Error::Internal(anyhow::anyhow!(
                    "unsupported auth challenge purpose"
                )));
            }
        };

        let session_token = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(Uuid::new_v4())
        .bind(user.id)
        .bind(hash_session_token(&session_token))
        .bind(Utc::now() + Duration::days(SESSION_TTL_DAYS))
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1")
            .bind(user.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok((public_user_db(&user), session_token))
    }

    async fn verify_code_memory(&self, request: &CodeVerification) -> Result<(PublicUser, String)> {
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
            let attempts_exhausted = pending.attempts >= MAX_CODE_ATTEMPTS;
            if attempts_exhausted {
                store.pending_codes.remove(&email);
            }
            return Err(if attempts_exhausted {
                Error::Config("验证码尝试次数过多，请重新发送".to_string())
            } else {
                Error::Config("验证码不正确".to_string())
            });
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

    pub async fn session_user(
        &self,
        session_token: Option<&str>,
    ) -> Result<Option<AuthenticatedUser>> {
        let Some(session_token) = session_token else {
            return Ok(None);
        };
        if let Some(pool) = &self.pool {
            let user = sqlx::query_as::<_, DbSessionUser>(
                "SELECT u.id, u.email, u.display_name, u.created_at
                 FROM auth_sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = $1
                   AND s.revoked_at IS NULL
                   AND s.expires_at > NOW()",
            )
            .bind(hash_session_token(session_token))
            .fetch_optional(pool)
            .await?;
            return Ok(user.map(|user| AuthenticatedUser {
                user: public_user_db_session(&user),
            }));
        }

        let mut store = self.inner.write().await;
        let session = store.sessions.get(session_token).cloned();
        let Some(session) = session else {
            return Ok(None);
        };
        if session.expires_at < Utc::now() {
            store.sessions.remove(session_token);
            return Ok(None);
        }
        let user = store
            .users
            .values()
            .find(|user| user.id == session.user_id)
            .cloned();
        Ok(user.map(|user| AuthenticatedUser {
            user: public_user(&user),
        }))
    }

    pub async fn remove_session(&self, session_token: Option<&str>) -> Result<()> {
        let Some(session_token) = session_token else {
            return Ok(());
        };
        if let Some(pool) = &self.pool {
            sqlx::query(
                "UPDATE auth_sessions
                 SET revoked_at = COALESCE(revoked_at, NOW())
                 WHERE token_hash = $1",
            )
            .bind(hash_session_token(session_token))
            .execute(pool)
            .await?;
            return Ok(());
        }

        self.inner.write().await.sessions.remove(session_token);
        Ok(())
    }

    /// Creates a deterministic in-memory session for route tests only.
    pub async fn create_test_session(&self) -> String {
        let mut store = self.inner.write().await;
        let user = User {
            id: Uuid::new_v4(),
            email: "test@example.com".to_string(),
            display_name: "Test Operator".to_string(),
            created_at: Utc::now(),
        };
        let session_token = "test-session".to_string();
        store.users.insert(user.email.clone(), user.clone());
        store.sessions.insert(
            session_token.clone(),
            Session {
                user_id: user.id,
                expires_at: Utc::now() + Duration::days(SESSION_TTL_DAYS),
            },
        );
        session_token
    }

    #[doc(hidden)]
    pub fn test_last_code(&self) -> Option<String> {
        match &self.mailer {
            Mailer::Test(code) => code.lock().ok().and_then(|value| value.clone()),
            Mailer::Cloudflare => None,
        }
    }

    async fn send_code(&self, recipient: &str, code: &str) -> Result<()> {
        match &self.mailer {
            Mailer::Cloudflare => EmailSender::from_env()?.send_code(recipient, code).await,
            Mailer::Test(captured) => {
                if let Ok(mut value) = captured.lock() {
                    *value = Some(code.to_string());
                }
                Ok(())
            }
        }
    }
}

async fn consume_challenge(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>, id: Uuid) -> Result<()> {
    sqlx::query("UPDATE auth_challenges SET consumed_at = NOW() WHERE id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    Ok(())
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

fn generate_code() -> String {
    format!("{:06}", (Uuid::new_v4().as_u128() % 1_000_000) as u32)
}

fn purpose_name(purpose: AuthPurpose) -> &'static str {
    match purpose {
        AuthPurpose::Register => "register",
        AuthPurpose::Login => "login",
    }
}

fn session_secret() -> String {
    env::var("SESSION_SECRET").unwrap_or_else(|_| "looptask-local-session".to_string())
}

fn hash_code(email: &str, code: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(session_secret().as_bytes()).expect("HMAC accepts any key");
    mac.update(format!("code:{email}:{code}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn hash_session_token(token: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(session_secret().as_bytes()).expect("HMAC accepts any key");
    mac.update(format!("session:{token}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn public_user_db(user: &DbUser) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        created_at: user.created_at,
    }
}

fn public_user(user: &User) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        created_at: user.created_at,
    }
}

fn public_user_db_session(user: &DbSessionUser) -> PublicUser {
    PublicUser {
        id: user.id,
        email: user.email.clone(),
        display_name: user.display_name.clone(),
        created_at: user.created_at,
    }
}
