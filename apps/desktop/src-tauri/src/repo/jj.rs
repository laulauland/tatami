use anyhow::{Context, Result};
use jj_lib::backend::{ChangeId, CommitId};
use jj_lib::commit::Commit;
use jj_lib::config::ConfigSource;
use jj_lib::git;
use jj_lib::merged_tree::MergedTree;
use jj_lib::object_id::{HexPrefix, ObjectId, PrefixResolution};
use jj_lib::op_store::OperationId;
use jj_lib::op_walk;
use jj_lib::repo::{Repo, StoreFactories};
use jj_lib::repo_path::RepoPath;
use jj_lib::settings::UserSettings;
use jj_lib::workspace::{Workspace, default_working_copy_factories};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use tokio::io::AsyncReadExt;

/// Result of a mutation operation, containing both the result and the operation ID for undo
#[derive(Debug, Clone, Serialize)]
pub struct MutationResult {
    /// The operation ID of this mutation (hex-encoded)
    pub operation_id: String,
    /// For new_revision: the change ID of the new revision
    pub change_id: Option<String>,
}

/// An operation in the jj operation log
#[derive(Debug, Clone, Serialize)]
pub struct Operation {
    pub id: String,
    pub parent_ids: Vec<String>,
    pub description: String,
    pub timestamp: String,
    pub user: String,
    pub hostname: String,
    /// The working copy change ID after this operation (if any)
    pub working_copy_change_id: Option<String>,
}

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

    pub fn get_conflict_paths(&self, change_id: &str) -> Result<Vec<String>> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let commit_id = self.resolve_change_id(repo.as_ref(), change_id)?;
        let commit = repo.store().get_commit(&commit_id)?;
        let tree = commit.tree()?;

        let mut paths = Vec::new();
        for (path, value) in tree.conflicts() {
            value?;
            paths.push(path.as_internal_file_string().to_string());
        }

        paths.sort();
        paths.dedup();
        Ok(paths)
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
        let repo = self.workspace.repo_loader().load_at_head()?;
        self.get_file_content_with_repo(repo.as_ref(), commit, path)
    }

    pub fn get_parent_file_content(&self, commit: &Commit, path: &str) -> Result<Vec<u8>> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        self.get_parent_file_content_with_repo(repo.as_ref(), commit, path)
    }

    /// Get file content using an already-loaded repo (avoids redundant load_at_head)
    pub fn get_file_content_with_repo(
        &self,
        repo: &dyn Repo,
        commit: &Commit,
        path: &str,
    ) -> Result<Vec<u8>> {
        use jj_lib::backend::TreeValue;

        let repo_path = RepoPath::from_internal_string(path).context("Invalid path")?;
        let tree = commit.tree()?;
        let file_value = tree.path_value(repo_path)?;

        match file_value.into_resolved() {
            Ok(Some(value)) => match value {
                TreeValue::File { id, .. } => {
                    let mut reader =
                        pollster::block_on(async { repo.store().read_file(repo_path, &id).await })?;
                    let mut content = Vec::new();
                    pollster::block_on(async { reader.read_to_end(&mut content).await })?;
                    Ok(content)
                }
                _ => Ok(Vec::new()),
            },
            Ok(None) => Ok(Vec::new()),
            Err(_) => Ok(Vec::new()),
        }
    }

    /// Get parent file content using an already-loaded repo (avoids redundant load_at_head)
    pub fn get_parent_file_content_with_repo(
        &self,
        repo: &dyn Repo,
        commit: &Commit,
        path: &str,
    ) -> Result<Vec<u8>> {
        use jj_lib::backend::TreeValue;

        let repo_path = RepoPath::from_internal_string(path).context("Invalid path")?;
        let parent = commit.parents().next();

        if let Some(parent_result) = parent {
            let parent_commit = parent_result?;
            let tree = parent_commit.tree()?;
            let file_value = tree.path_value(repo_path)?;

            match file_value.into_resolved() {
                Ok(Some(value)) => match value {
                    TreeValue::File { id, .. } => {
                        let mut reader = pollster::block_on(async {
                            repo.store().read_file(repo_path, &id).await
                        })?;
                        let mut content = Vec::new();
                        pollster::block_on(async { reader.read_to_end(&mut content).await })?;
                        Ok(content)
                    }
                    _ => Ok(Vec::new()),
                },
                Ok(None) => Ok(Vec::new()),
                Err(_) => Ok(Vec::new()),
            }
        } else {
            Ok(Vec::new())
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

    pub fn user_settings(&self) -> &UserSettings {
        &self.user_settings
    }

    pub fn workspace_name(&self) -> &jj_lib::ref_name::WorkspaceName {
        self.workspace.workspace_name()
    }

    pub fn workspace_root(&self) -> &Path {
        self.workspace.workspace_root()
    }

    /// Generate change IDs using jj-lib's RNG. Returns reverse-hex encoded IDs.
    pub fn generate_change_ids(&self, count: usize) -> Result<Vec<String>> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let rng = self.user_settings.get_rng();
        let length = repo.store().change_id_length();

        let ids: Vec<String> = (0..count)
            .map(|_| rng.new_change_id(length).reverse_hex())
            .collect();

        Ok(ids)
    }

    pub fn new_revision(
        &mut self,
        parent_change_ids: Vec<String>,
        change_id: Option<String>,
    ) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve parent change IDs to commit IDs and get commits
        let mut parent_commits = Vec::new();
        for change_id in parent_change_ids {
            let commit_id = self.resolve_change_id(repo.as_ref(), &change_id)?;
            let commit = repo
                .store()
                .get_commit(&commit_id)
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
        let mut commit_builder = tx.repo_mut().new_commit(parent_commit_ids, tree_id);

        // Set pre-generated change ID if provided
        if let Some(ref cid) = change_id {
            let parsed = ChangeId::try_from_reverse_hex(cid).context("Invalid change ID format")?;
            commit_builder = commit_builder.set_change_id(parsed);
        }

        let new_commit = commit_builder
            .write()
            .map_err(|e| anyhow::anyhow!("Failed to write commit: {}", e))?;

        // Get the actual change ID (either provided or generated)
        let actual_change_id = new_commit.change_id().reverse_hex();

        // Set as working copy
        let workspace_name = self.workspace.workspace_name().to_owned();
        tx.repo_mut()
            .set_wc_commit(workspace_name, new_commit.id().clone())
            .context("Failed to set working copy commit")?;

        // Get old tree for checkout
        let old_commit = repo
            .store()
            .get_commit(
                repo.view()
                    .get_wc_commit_id(self.workspace.workspace_name())
                    .context("No working copy commit")?,
            )
            .map_err(|e| anyhow::anyhow!("Failed to get old commit: {}", e))?;
        let old_tree_id = old_commit.tree_id().clone();

        // Finalize transaction
        let new_repo = tx.commit("new")?;
        let operation_id = new_repo.operation().id().clone();

        // Check out the new commit in the working copy
        self.workspace
            .check_out(operation_id.clone(), Some(&old_tree_id), &new_commit)
            .context("Failed to check out new commit")?;

        Ok(MutationResult {
            operation_id: operation_id.hex(),
            change_id: Some(actual_change_id),
        })
    }

    pub fn abandon_revision(&mut self, change_id: &str) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve change ID to commit
        let commit_id = self.resolve_change_id(repo.as_ref(), change_id)?;
        let commit = repo
            .store()
            .get_commit(&commit_id)
            .map_err(|e| anyhow::anyhow!("Failed to get commit: {}", e))?;

        // Get the current working copy info before changes
        let wc_commit_id = repo
            .view()
            .get_wc_commit_id(self.workspace.workspace_name())
            .cloned();
        let is_abandoning_wc = wc_commit_id.as_ref() == Some(commit.id());

        // Record the commit as abandoned
        tx.repo_mut().record_abandoned_commit(&commit);

        // Rebase descendants (this handles moving children to the parent)
        tx.repo_mut().rebase_descendants()?;

        // If we abandoned the working copy, check out the parent
        let final_op_id = if is_abandoning_wc {
            let parent_id = commit
                .parent_ids()
                .first()
                .cloned()
                .context("Abandoned commit has no parent")?;
            let parent_commit = repo.store().get_commit(&parent_id)?;

            // Set the parent as the new working copy
            let workspace_name = self.workspace.workspace_name().to_owned();
            tx.repo_mut()
                .set_wc_commit(workspace_name, parent_id.clone())
                .context("Failed to set working copy commit")?;

            // Finalize transaction before checkout
            let new_repo = tx.commit("abandon")?;
            let operation_id = new_repo.operation().id().clone();

            // Check out the parent commit
            let old_tree_id = commit.tree_id().clone();
            self.workspace
                .check_out(operation_id.clone(), Some(&old_tree_id), &parent_commit)
                .context("Failed to check out parent commit")?;

            operation_id
        } else {
            // Finalize transaction
            let new_repo = tx.commit("abandon")?;
            new_repo.operation().id().clone()
        };

        Ok(MutationResult {
            operation_id: final_op_id.hex(),
            change_id: None,
        })
    }

    pub fn edit_revision(&mut self, change_id: String) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve change ID to commit
        let commit_id = self.resolve_change_id(repo.as_ref(), &change_id)?;
        let commit = repo
            .store()
            .get_commit(&commit_id)
            .map_err(|e| anyhow::anyhow!("Failed to get commit: {}", e))?;

        // Set as working copy
        let workspace_name = self.workspace.workspace_name().to_owned();
        tx.repo_mut()
            .set_wc_commit(workspace_name, commit.id().clone())
            .context("Failed to set working copy commit")?;

        // Get old tree for checkout
        let old_commit = repo
            .store()
            .get_commit(
                repo.view()
                    .get_wc_commit_id(self.workspace.workspace_name())
                    .context("No working copy commit")?,
            )
            .map_err(|e| anyhow::anyhow!("Failed to get old commit: {}", e))?;
        let old_tree_id = old_commit.tree_id().clone();

        // Finalize transaction
        let new_repo = tx.commit("edit")?;
        let operation_id = new_repo.operation().id().clone();

        // Check out the commit in the working copy
        self.workspace
            .check_out(operation_id.clone(), Some(&old_tree_id), &commit)
            .context("Failed to check out commit")?;

        Ok(MutationResult {
            operation_id: operation_id.hex(),
            change_id: None,
        })
    }

    pub fn describe_revision(
        &mut self,
        change_id: &str,
        description: String,
    ) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let mut tx = repo.start_transaction();

        // Resolve change ID to commit
        let commit_id = self.resolve_change_id(repo.as_ref(), change_id)?;
        let commit = repo
            .store()
            .get_commit(&commit_id)
            .map_err(|e| anyhow::anyhow!("Failed to get commit: {}", e))?;

        // For now, only root commit is immutable in this app's revset model
        if commit.id() == repo.store().root_commit_id() {
            anyhow::bail!("Cannot describe immutable commit");
        }

        let workspace_name = self.workspace.workspace_name();
        let wc_commit_id = repo.view().get_wc_commit_id(workspace_name).cloned();
        let is_describing_wc = wc_commit_id.as_ref() == Some(commit.id());
        let old_tree_id = if is_describing_wc {
            Some(commit.tree_id().clone())
        } else {
            None
        };

        let new_commit = tx
            .repo_mut()
            .rewrite_commit(&commit)
            .set_description(description)
            .write()
            .map_err(|e| anyhow::anyhow!("Failed to write rewritten commit: {}", e))?;

        tx.repo_mut().rebase_descendants()?;

        let new_repo = tx.commit("describe")?;
        let operation_id = new_repo.operation().id().clone();

        // Keep working copy metadata in sync if we rewrote the checked-out commit.
        // Tree content is unchanged, so this won't modify files on disk.
        if is_describing_wc {
            self.workspace
                .check_out(operation_id.clone(), old_tree_id.as_ref(), &new_commit)
                .context("Failed to keep working copy in sync after describe")?;
        }

        Ok(MutationResult {
            operation_id: operation_id.hex(),
            change_id: None,
        })
    }

    pub fn git_fetch(&mut self, remote: Option<String>) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let remote_name: jj_lib::ref_name::RemoteNameBuf =
            remote.unwrap_or_else(|| "origin".to_string()).into();

        let remotes = git::get_all_remote_names(repo.store())?;
        if remotes.is_empty() {
            anyhow::bail!("No git remotes configured");
        }
        if !remotes.iter().any(|r| r == &remote_name) {
            anyhow::bail!("No git remote named '{}'", remote_name.as_str());
        }

        let git_settings = self
            .user_settings
            .git_settings()
            .context("Failed to load git settings")?;
        let git_repo = git::get_git_repo(repo.store())?;
        let (_, refspecs) = git::expand_default_fetch_refspecs(remote_name.as_ref(), &git_repo)?;

        let mut tx = repo.start_transaction();
        let mut git_fetch = git::GitFetch::new(tx.repo_mut(), &git_settings)?;
        git_fetch.fetch(
            remote_name.as_ref(),
            refspecs,
            git::RemoteCallbacks::default(),
            None,
            None,
        )?;
        git_fetch.import_refs()?;

        let new_repo = tx.commit(format!("fetch from git remote {}", remote_name.as_str()))?;

        Ok(MutationResult {
            operation_id: new_repo.operation().id().hex(),
            change_id: None,
        })
    }

    pub fn git_push(
        &mut self,
        remote: Option<String>,
        bookmark_names: Vec<String>,
    ) -> Result<MutationResult> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let remote_name: jj_lib::ref_name::RemoteNameBuf =
            remote.unwrap_or_else(|| "origin".to_string()).into();

        let remotes = git::get_all_remote_names(repo.store())?;
        if remotes.is_empty() {
            anyhow::bail!("No git remotes configured");
        }
        if !remotes.iter().any(|r| r == &remote_name) {
            anyhow::bail!("No git remote named '{}'", remote_name.as_str());
        }

        let requested: HashSet<&str> = bookmark_names.iter().map(String::as_str).collect();
        let mut found_any = false;
        let mut branch_updates = Vec::new();
        for (name, targets) in repo.view().local_remote_bookmarks(remote_name.as_ref()) {
            if !requested.contains(name.as_str()) {
                continue;
            }
            found_any = true;

            match jj_lib::refs::classify_bookmark_push_action(targets) {
                jj_lib::refs::BookmarkPushAction::Update(update) => {
                    branch_updates.push((name.to_owned(), update));
                }
                jj_lib::refs::BookmarkPushAction::AlreadyMatches => {}
                jj_lib::refs::BookmarkPushAction::LocalConflicted => {
                    anyhow::bail!("Cannot push conflicted local bookmark '{}'", name.as_str())
                }
                jj_lib::refs::BookmarkPushAction::RemoteConflicted => {
                    anyhow::bail!(
                        "Cannot push bookmark '{}' because remote is conflicted",
                        name.as_str()
                    )
                }
                jj_lib::refs::BookmarkPushAction::RemoteUntracked => {
                    anyhow::bail!(
                        "Cannot push bookmark '{}' because remote bookmark is untracked",
                        name.as_str()
                    )
                }
            }
        }

        if !found_any {
            anyhow::bail!(
                "No matching bookmarks found to push: {}",
                bookmark_names.join(", ")
            );
        }

        if branch_updates.is_empty() {
            anyhow::bail!(
                "No bookmark updates to push for remote '{}': {}",
                remote_name.as_str(),
                bookmark_names.join(", ")
            );
        }

        let git_settings = self
            .user_settings
            .git_settings()
            .context("Failed to load git settings")?;

        let mut tx = repo.start_transaction();
        git::push_branches(
            tx.repo_mut(),
            &git_settings,
            remote_name.as_ref(),
            &git::GitBranchPushTargets { branch_updates },
            git::RemoteCallbacks::default(),
        )?;

        let new_repo = tx.commit(format!("push to git remote {}", remote_name.as_str()))?;

        Ok(MutationResult {
            operation_id: new_repo.operation().id().hex(),
            change_id: None,
        })
    }

    /// Walk the operation log to find when each commit was last the working copy.
    /// Returns a map of commit_id (hex) -> timestamp_millis.
    /// This is used to determine "recency" for branch ordering.
    pub fn get_commit_recency(&self, limit: usize) -> Result<HashMap<String, i64>> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let current_op = repo.operation();
        let workspace_name = self.workspace.workspace_name();

        let mut recency: HashMap<String, i64> = HashMap::new();

        // Walk operations from newest to oldest
        let op_iter = op_walk::walk_ancestors(std::slice::from_ref(current_op));

        for (idx, op_result) in op_iter.enumerate() {
            if idx >= limit {
                break;
            }

            let op = op_result.context("Failed to load operation")?;
            let metadata = op.metadata();
            let timestamp_millis = metadata.time.start.timestamp.0;

            // Get the view for this operation to see what was the WC
            let view = op.view().context("Failed to load operation view")?;

            // Check what commit was the working copy at this operation
            if let Some(wc_commit_id) = view.wc_commit_ids().get(workspace_name) {
                let commit_hex = wc_commit_id.hex();
                // Only record the first (most recent) occurrence
                recency.entry(commit_hex).or_insert(timestamp_millis);
            }
        }

        Ok(recency)
    }

    /// List operations from newest to oldest
    pub fn list_operations(&self, limit: usize) -> Result<Vec<Operation>> {
        let repo = self.workspace.repo_loader().load_at_head()?;
        let current_op = repo.operation();
        let workspace_name = self.workspace.workspace_name();

        let mut operations = Vec::new();

        let op_iter = op_walk::walk_ancestors(std::slice::from_ref(current_op));

        for (idx, op_result) in op_iter.enumerate() {
            if idx >= limit {
                break;
            }

            let op = op_result.context("Failed to load operation")?;
            let metadata = op.metadata();

            // Get parent operation IDs
            let parent_ids: Vec<String> = op.parent_ids().iter().map(|id| id.hex()).collect();

            // Get the working copy change ID from this operation's view
            let working_copy_change_id = op.view().ok().and_then(|view| {
                view.wc_commit_ids()
                    .get(workspace_name)
                    .and_then(|commit_id| {
                        // Look up the commit to get its change ID
                        repo.store()
                            .get_commit(commit_id)
                            .ok()
                            .map(|commit| commit.change_id().reverse_hex())
                    })
            });

            // Format timestamp as ISO 8601
            let timestamp =
                chrono::DateTime::from_timestamp_millis(metadata.time.start.timestamp.0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_else(|| "unknown".to_string());

            operations.push(Operation {
                id: op.id().hex(),
                parent_ids,
                description: metadata.description.clone(),
                timestamp,
                user: metadata.username.clone(),
                hostname: metadata.hostname.clone(),
                working_copy_change_id,
            });
        }

        Ok(operations)
    }

    /// Undo a specific operation by reverting it (3-way merge to invert just that op)
    pub fn undo_operation(&mut self, op_id_hex: &str) -> Result<()> {
        let repo = self.workspace.repo_loader().load_at_head()?;

        // Parse the operation ID
        let op_id = OperationId::try_from_hex(op_id_hex).context("Invalid operation ID format")?;

        // Load the operation to undo
        let bad_op = repo
            .loader()
            .load_operation(&op_id)
            .context("Failed to load operation to undo")?;

        // Get the parent operation (the state before the bad op)
        let parent_op = bad_op
            .parents()
            .next()
            .context("Operation has no parent (cannot undo root operation)")?
            .context("Failed to load parent operation")?;

        // Start a transaction for the revert
        let mut tx = repo.start_transaction();

        // Load repos at both states for 3-way merge
        let repo_loader = tx.base_repo().loader();
        let bad_repo = repo_loader
            .load_at(&bad_op)
            .context("Failed to load repo at bad operation")?;
        let parent_repo = repo_loader
            .load_at(&parent_op)
            .context("Failed to load repo at parent operation")?;

        // Perform 3-way merge to revert the operation
        tx.repo_mut().merge(&bad_repo, &parent_repo)?;

        // Get old tree for checkout (current WC)
        let old_wc_commit_id = repo
            .view()
            .get_wc_commit_id(self.workspace.workspace_name())
            .cloned();
        let old_tree_id = old_wc_commit_id
            .as_ref()
            .and_then(|id| repo.store().get_commit(id).ok())
            .map(|c| c.tree_id().clone());

        // Commit the revert
        let new_repo = tx.commit(format!(
            "undo operation {}",
            &op_id_hex[..12.min(op_id_hex.len())]
        ))?;
        let new_op_id = new_repo.operation().id().clone();

        // Update working copy if it changed
        if let Some(new_wc_commit_id) = new_repo
            .view()
            .get_wc_commit_id(self.workspace.workspace_name())
        {
            if old_wc_commit_id.as_ref() != Some(new_wc_commit_id) {
                let new_wc_commit = new_repo
                    .store()
                    .get_commit(new_wc_commit_id)
                    .context("Failed to get new working copy commit")?;
                self.workspace
                    .check_out(new_op_id, old_tree_id.as_ref(), &new_wc_commit)
                    .context("Failed to check out after undo")?;
            }
        }

        Ok(())
    }
}
