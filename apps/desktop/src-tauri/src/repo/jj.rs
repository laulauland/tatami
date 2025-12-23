use anyhow::{Context, Result};
use jj_lib::backend::CommitId;
use jj_lib::commit::Commit;
use jj_lib::config::ConfigSource;
use jj_lib::merged_tree::MergedTree;
use jj_lib::object_id::{HexPrefix, PrefixResolution};
use jj_lib::repo::{Repo, StoreFactories};
use jj_lib::repo_path::RepoPath;
use jj_lib::settings::UserSettings;
use jj_lib::workspace::{Workspace, default_working_copy_factories};
use std::path::Path;
use tokio::io::AsyncReadExt;

pub struct JjRepo {
    workspace: Workspace,
    #[allow(dead_code)] // Used by jj-lib internals via workspace
    user_settings: UserSettings,
}

impl JjRepo {
    pub fn open(path: &Path) -> Result<Self> {
        let config = Self::load_config()?;
        let user_settings = jj_lib::settings::UserSettings::from_config(config)
            .context("Failed to create user settings")?;
        let store_factories = StoreFactories::default();
        let working_copy_factories = default_working_copy_factories();

        let workspace = Workspace::load(
            &user_settings,
            path,
            &store_factories,
            &working_copy_factories,
        )
        .context("Failed to load jj workspace")?;

        Ok(Self {
            workspace,
            user_settings,
        })
    }

    fn load_config() -> Result<jj_lib::config::StackedConfig> {
        use jj_lib::config::{ConfigLayer, StackedConfig};

        let mut config = StackedConfig::with_defaults();

        // Add environment-based defaults for operation metadata (matching jj-cli behavior)
        let mut env_layer = ConfigLayer::empty(ConfigSource::EnvBase);
        if let Ok(hostname) = whoami::fallible::hostname() {
            env_layer.set_value("operation.hostname", hostname).unwrap();
        }
        if let Ok(username) = whoami::fallible::username() {
            env_layer.set_value("operation.username", username).unwrap();
        } else if let Ok(username) = std::env::var("USER") {
            env_layer.set_value("operation.username", username).unwrap();
        }
        config.add_layer(env_layer);

        if let Ok(home) = std::env::var("HOME") {
            let xdg_config = std::env::var("XDG_CONFIG_HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| Path::new(&home).join(".config"));

            let jj_config = xdg_config.join("jj/config.toml");
            if jj_config.exists() {
                let _ = config.load_file(ConfigSource::User, &jj_config);
            }

            let legacy = Path::new(&home).join(".jjconfig.toml");
            if legacy.exists() {
                let _ = config.load_file(ConfigSource::User, &legacy);
            }
        }

        Ok(config)
    }

    pub fn get_commit(&self, change_id: &str) -> Result<Commit> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let commit_id = self.resolve_change_id(repo.as_ref(), change_id)?;
        Ok(repo.store().get_commit(&commit_id)?)
    }

    #[allow(dead_code)] // May be used in future features
    pub fn get_parent_tree(&self, commit: &Commit) -> Result<MergedTree> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let parents = commit.parents();
        let parent = parents.into_iter().next().context("Commit has no parent")?;
        let parent_commit = repo.store().get_commit(parent?.id())?;
        Ok(parent_commit.tree()?)
    }

    pub fn get_file_content(&self, commit: &Commit, path: &str) -> Result<Vec<u8>> {
        let repo_path = RepoPath::from_internal_string(path).context("Invalid path")?;
        let tree = commit.tree()?;
        let file_value = tree.path_value(repo_path)?;

        match file_value.into_resolved() {
            Ok(Some(value)) => {
                use jj_lib::backend::TreeValue;
                match value {
                    TreeValue::File { id, .. } => {
                        let repo = self.workspace.repo_loader().load_at_head()?;
                        let mut reader = pollster::block_on(async {
                            repo.store().read_file(repo_path, &id).await
                        })?;
                        let mut content = Vec::new();
                        pollster::block_on(async { reader.read_to_end(&mut content).await })?;
                        Ok(content)
                    }
                    _ => Ok(Vec::new()),
                }
            }
            _ => Ok(Vec::new()),
        }
    }

    pub fn get_parent_file_content(&self, commit: &Commit, path: &str) -> Result<Vec<u8>> {
        let repo_path = RepoPath::from_internal_string(path).context("Invalid path")?;
        let repo = self.workspace.repo_loader().load_at_head()?;
        let parents = commit.parents();
        let parent = parents.into_iter().next().context("Commit has no parent")?;
        let parent_commit = repo.store().get_commit(parent?.id())?;
        let parent_tree = parent_commit.tree()?;
        let file_value = parent_tree.path_value(repo_path)?;

        match file_value.into_resolved() {
            Ok(Some(value)) => {
                use jj_lib::backend::TreeValue;
                match value {
                    TreeValue::File { id, .. } => {
                        let mut reader = pollster::block_on(async {
                            repo.store().read_file(repo_path, &id).await
                        })?;
                        let mut content = Vec::new();
                        pollster::block_on(async { reader.read_to_end(&mut content).await })?;
                        Ok(content)
                    }
                    _ => Ok(Vec::new()),
                }
            }
            _ => Ok(Vec::new()),
        }
    }

    fn resolve_change_id(&self, repo: &impl Repo, change_id_prefix: &str) -> Result<CommitId> {
        let prefix = HexPrefix::try_from_reverse_hex(change_id_prefix)
            .context("Invalid change ID prefix format")?;

        let resolution = repo
            .resolve_change_id_prefix(&prefix)
            .context("Failed to resolve change ID")?;

        match resolution {
            PrefixResolution::SingleMatch(commit_ids) => {
                commit_ids.first().cloned().context("No commit ID found")
            }
            PrefixResolution::NoMatch => {
                anyhow::bail!("Change ID not found: {}", change_id_prefix)
            }
            PrefixResolution::AmbiguousMatch => {
                anyhow::bail!("Ambiguous change ID prefix: {}", change_id_prefix)
            }
        }
    }

    pub fn repo_loader(&self) -> &jj_lib::repo::RepoLoader {
        self.workspace.repo_loader()
    }

    pub fn new_revision(&mut self, parent_change_ids: Vec<String>) -> Result<()> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve parent change IDs to commit IDs and get commits
        let mut parent_commits = Vec::new();
        for change_id in parent_change_ids {
            let commit_id = self.resolve_change_id(repo.as_ref(), &change_id)?;
            let commit = repo.store().get_commit(&commit_id)
                .map_err(|e| anyhow::anyhow!("Failed to get commit: {}", e))?;
            parent_commits.push(commit);
        }

        // Get the tree from the first parent (empty commit uses parent's tree)
        let tree_id = parent_commits
            .first()
            .context("No parent commits provided")?
            .tree_id()
            .clone();

        // Create new commit with parent commits and their tree (no changes)
        let parent_commit_ids: Vec<_> = parent_commits.iter().map(|c| c.id().clone()).collect();
        let new_commit = tx
            .repo_mut()
            .new_commit(parent_commit_ids, tree_id)
            .write()
            .map_err(|e| anyhow::anyhow!("Failed to write commit: {}", e))?;

        // Set as working copy
        let workspace_name = self.workspace.workspace_name().to_owned();
        tx.repo_mut()
            .set_wc_commit(workspace_name, new_commit.id().clone())
            .context("Failed to set working copy commit")?;

        // Get old tree for checkout
        let old_commit = repo
            .store()
            .get_commit(repo.view().get_wc_commit_id(self.workspace.workspace_name())
            .context("No working copy commit")?)
            .map_err(|e| anyhow::anyhow!("Failed to get old commit: {}", e))?;
        let old_tree_id = old_commit.tree_id().clone();

        // Finalize transaction
        let new_repo = tx.commit("new")?;
        let operation_id = new_repo.operation().id().clone();

        // Check out the new commit in the working copy
        self.workspace
            .check_out(operation_id, Some(&old_tree_id), &new_commit)
            .context("Failed to check out new commit")?;

        Ok(())
    }

    pub fn edit_revision(&mut self, change_id: String) -> Result<()> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve change ID to commit
        let commit_id = self.resolve_change_id(repo.as_ref(), &change_id)?;
        let commit = repo.store().get_commit(&commit_id)
            .map_err(|e| anyhow::anyhow!("Failed to get commit: {}", e))?;

        // Set as working copy
        let workspace_name = self.workspace.workspace_name().to_owned();
        tx.repo_mut()
            .set_wc_commit(workspace_name, commit.id().clone())
            .context("Failed to set working copy commit")?;

        // Get old tree for checkout
        let old_commit = repo
            .store()
            .get_commit(repo.view().get_wc_commit_id(self.workspace.workspace_name())
            .context("No working copy commit")?)
            .map_err(|e| anyhow::anyhow!("Failed to get old commit: {}", e))?;
        let old_tree_id = old_commit.tree_id().clone();

        // Finalize transaction
        let new_repo = tx.commit("edit")?;
        let operation_id = new_repo.operation().id().clone();

        // Check out the commit in the working copy
        self.workspace
            .check_out(operation_id, Some(&old_tree_id), &commit)
            .context("Failed to check out commit")?;

        Ok(())
    }
}
