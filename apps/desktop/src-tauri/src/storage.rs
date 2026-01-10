use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite, sqlite::SqlitePoolOptions};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened_at: i64,
    pub revset_preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppLayout {
    pub active_project_id: Option<String>,
    pub selected_change_id: Option<String>,
    pub sidebar_width: i32,
}

impl Default for AppLayout {
    fn default() -> Self {
        Self {
            active_project_id: None,
            selected_change_id: None,
            sidebar_width: 25,
        }
    }
}

pub struct Storage {
    pool: Pool<Sqlite>,
    layout: Mutex<AppLayout>,
}

impl Storage {
    pub async fn new(app_data_dir: std::path::PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        let db_path = app_data_dir.join("tatami.db");
        let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                last_opened_at INTEGER NOT NULL,
                revset_preset TEXT
            )
            "#,
        )
        .execute(&pool)
        .await?;

        // Migration: add revset_preset column if it doesn't exist
        let _ = sqlx::query("ALTER TABLE projects ADD COLUMN revset_preset TEXT")
            .execute(&pool)
            .await;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS layout (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await?;

        let layout = Self::load_layout(&pool).await.unwrap_or_default();

        Ok(Self {
            pool,
            layout: Mutex::new(layout),
        })
    }

    async fn load_layout(pool: &Pool<Sqlite>) -> Option<AppLayout> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM layout WHERE key = 'main'")
            .fetch_optional(pool)
            .await
            .ok()?;

        row.and_then(|(value,)| serde_json::from_str(&value).ok())
    }

    pub async fn get_projects(&self) -> anyhow::Result<Vec<Project>> {
        let rows: Vec<(String, String, String, i64, Option<String>)> = sqlx::query_as(
            "SELECT id, path, name, last_opened_at, revset_preset FROM projects ORDER BY last_opened_at DESC",
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|(id, path, name, last_opened_at, revset_preset)| Project {
                id,
                path,
                name,
                last_opened_at,
                revset_preset,
            })
            .collect())
    }

    pub async fn upsert_project(&self, project: &Project) -> anyhow::Result<()> {
        sqlx::query(
            r#"
            INSERT INTO projects (id, path, name, last_opened_at, revset_preset)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                path = excluded.path,
                name = excluded.name,
                last_opened_at = excluded.last_opened_at,
                revset_preset = excluded.revset_preset
            "#,
        )
        .bind(&project.id)
        .bind(&project.path)
        .bind(&project.name)
        .bind(project.last_opened_at)
        .bind(&project.revset_preset)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn find_project_by_path(&self, path: &str) -> anyhow::Result<Option<Project>> {
        let row: Option<(String, String, String, i64, Option<String>)> =
            sqlx::query_as("SELECT id, path, name, last_opened_at, revset_preset FROM projects WHERE path = ?")
                .bind(path)
                .fetch_optional(&self.pool)
                .await?;

        Ok(row.map(|(id, path, name, last_opened_at, revset_preset)| Project {
            id,
            path,
            name,
            last_opened_at,
            revset_preset,
        }))
    }

    pub async fn delete_project(&self, id: &str) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;

        // If the deleted project was active, clear persisted layout selection.
        let mut layout = self.layout.lock().await;
        if layout.active_project_id.as_deref() == Some(id) {
            layout.active_project_id = None;
            layout.selected_change_id = None;

            let value = serde_json::to_string(&*layout)?;
            sqlx::query("INSERT OR REPLACE INTO layout (key, value) VALUES ('main', ?)")
                .bind(&value)
                .execute(&self.pool)
                .await?;
        }

        Ok(())
    }

    pub async fn get_layout(&self) -> AppLayout {
        self.layout.lock().await.clone()
    }

    pub async fn update_layout(&self, updates: AppLayout) -> anyhow::Result<()> {
        let mut layout = self.layout.lock().await;

        let has_active_project_update = updates.active_project_id.is_some();
        if has_active_project_update {
            layout.active_project_id = updates.active_project_id;
        }
        if updates.selected_change_id.is_some() || has_active_project_update {
            layout.selected_change_id = updates.selected_change_id;
        }
        if updates.sidebar_width != 0 {
            layout.sidebar_width = updates.sidebar_width;
        }

        let value = serde_json::to_string(&*layout)?;
        sqlx::query("INSERT OR REPLACE INTO layout (key, value) VALUES ('main', ?)")
            .bind(&value)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}

pub fn get_storage(app: &AppHandle) -> Arc<Storage> {
    app.state::<Arc<Storage>>().inner().clone()
}
