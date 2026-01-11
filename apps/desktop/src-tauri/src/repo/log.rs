use anyhow::{Context, Result};
use jj_lib::backend::CommitId;
use jj_lib::git;
use jj_lib::graph::{GraphEdge, GraphEdgeType};
use jj_lib::object_id::ObjectId;
use jj_lib::repo::Repo;
use jj_lib::repo_path::RepoPathUiConverter;
use jj_lib::revset::{
    parse, RevsetAliasesMap, RevsetDiagnostics, RevsetExpression, RevsetExtensions,
    RevsetParseContext, RevsetWorkspaceContext, SymbolResolver, SymbolResolverExtension,
};
use std::collections::HashMap;
use std::path::Path;

use super::jj::JjRepo;

#[derive(Clone, Debug, serde::Serialize)]
pub struct ParentEdge {
    pub parent_id: String,
    pub edge_type: String,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Revision {
    pub commit_id: String,
    pub change_id: String,
    pub change_id_short: String,
    pub parent_ids: Vec<String>,
    pub parent_edges: Vec<ParentEdge>,
    pub description: String,
    pub author: String,
    pub timestamp: String,
    pub is_working_copy: bool,
    pub is_immutable: bool,
    pub is_mine: bool,
    pub is_trunk: bool,
    pub is_divergent: bool,
    pub divergent_index: Option<usize>,
    pub bookmarks: Vec<String>,
}

pub fn fetch_log(repo_path: &Path, limit: usize, revset: Option<&str>, preset: Option<&str>) -> Result<Vec<Revision>> {
    let jj_repo = JjRepo::open(repo_path)?;
    let repo = jj_repo.repo_loader().load_at_head()?;
    let user_email = jj_repo.user_settings().user_email();

    let wc_id = repo
        .view()
        .wc_commit_ids()
        .values()
        .next()
        .context("No working copy")?;

    // Determine which revset to use
    let revset_str = if let Some(custom_revset) = revset {
        custom_revset
    } else if let Some(preset_name) = preset {
        match preset_name {
            "my_work" => "mine() | present(@)",
            "active" => "present(@) | ancestors(immutable_heads().., 2) | present(trunk())",
            "full_history" => "ancestors(visible_heads())",
            _ => "present(@) | ancestors(immutable_heads().., 2) | present(trunk())", // default to active
        }
    } else {
        // Default to "active" preset
        "present(@) | ancestors(immutable_heads().., 2) | present(trunk())"
    };

    // Set up aliases needed for presets
    let mut aliases_map = RevsetAliasesMap::new();

    // trunk() - jj-cli style using remote_bookmarks with fallback to root
    aliases_map.insert(
        "trunk()",
        r#"latest(
            remote_bookmarks(exact:"main", exact:"origin") |
            remote_bookmarks(exact:"master", exact:"origin") |
            remote_bookmarks(exact:"trunk", exact:"origin") |
            root()
        )"#,
    ).ok();

    // builtin_immutable_heads() - trunk + tags + untracked remote bookmarks
    aliases_map.insert("builtin_immutable_heads()", "present(trunk()) | tags() | untracked_remote_bookmarks()").ok();

    // immutable_heads() - defaults to builtin
    aliases_map.insert("immutable_heads()", "builtin_immutable_heads()").ok();

    // mine() - commits authored by current user
    let mine_revset = format!(r#"author_email(exact-i:"{}")"#, user_email);
    aliases_map.insert("mine()", &mine_revset).ok();

    // Create workspace context for @ resolution
    let path_converter = RepoPathUiConverter::Fs {
        cwd: repo_path.to_path_buf(),
        base: repo_path.to_path_buf(),
    };
    let workspace_name = jj_repo.workspace_name();
    let workspace_ctx = RevsetWorkspaceContext {
        path_converter: &path_converter,
        workspace_name,
    };

    let context = RevsetParseContext {
        aliases_map: &aliases_map,
        local_variables: HashMap::new(),
        user_email: jj_repo.user_settings().user_email(),
        date_pattern_context: chrono::Utc::now().fixed_offset().into(),
        default_ignored_remote: Some(git::REMOTE_NAME_FOR_LOCAL_GIT_REPO),
        extensions: &RevsetExtensions::default(),
        workspace: Some(workspace_ctx),
    };

    let mut diagnostics = RevsetDiagnostics::new();
    let expression = parse(&mut diagnostics, revset_str, &context)
        .context("Failed to parse revset")?;

    let symbol_resolver = SymbolResolver::new(repo.as_ref(), &([] as [&Box<dyn SymbolResolverExtension>; 0]));
    let resolved = expression.resolve_user_expression(repo.as_ref(), &symbol_resolver)
        .context("Failed to resolve revset")?;

    let revset_expression = resolved.evaluate(repo.as_ref())
        .context("Failed to evaluate revset")?;

    // Use iter_graph() to get commits with edge information
    let graph_nodes: Vec<(CommitId, Vec<GraphEdge<CommitId>>)> = revset_expression
        .iter_graph()
        .take(limit)
        .map(|result| {
            result.map_err(|e| anyhow::anyhow!("Graph iteration error: {}", e))
        })
        .collect::<Result<Vec<_>>>()?;

    let immutable_expression = RevsetExpression::root();
    let immutable_revset = immutable_expression.evaluate(repo.as_ref())?;
    let immutable_ids: Vec<CommitId> = immutable_revset.iter().collect::<Result<Vec<_>, _>>()?;

    // Evaluate ::trunk() to identify trunk ancestors
    let trunk_ancestor_ids: std::collections::HashSet<CommitId> = {
        let mut trunk_diagnostics = RevsetDiagnostics::new();
        match parse(&mut trunk_diagnostics, "::trunk()", &context) {
            Ok(trunk_expr) => {
                match trunk_expr.resolve_user_expression(repo.as_ref(), &symbol_resolver) {
                    Ok(resolved) => {
                        match resolved.evaluate(repo.as_ref()) {
                            Ok(revset) => revset.iter().filter_map(|r| r.ok()).collect(),
                            Err(_) => std::collections::HashSet::new(),
                        }
                    }
                    Err(_) => std::collections::HashSet::new(),
                }
            }
            Err(_) => std::collections::HashSet::new(),
        }
    };

    // First pass: count occurrences of each change_id to detect divergence
    let mut change_id_counts: HashMap<String, usize> = HashMap::new();
    let mut commit_change_ids: Vec<String> = Vec::new();

    for (commit_id, _) in &graph_nodes {
        let commit = repo.store().get_commit(commit_id)?;
        let change_id_str = format_change_id(commit.change_id());
        *change_id_counts.entry(change_id_str.clone()).or_insert(0) += 1;
        commit_change_ids.push(change_id_str);
    }

    // Track which index we're at for each divergent change_id
    let mut divergent_indices: HashMap<String, usize> = HashMap::new();

    let mut revisions = Vec::new();

    for (commit_id, edges) in graph_nodes {
        let commit = repo.store().get_commit(&commit_id)?;
        let change_id = commit.change_id();
        let is_working_copy = wc_id == &commit_id;
        let is_immutable = immutable_ids.contains(&commit_id);

        let description = commit.description().to_string();

        let author = commit.author();
        let author_name = author.name.clone();
        let author_email = author.email.clone();
        let is_mine = author_email == user_email;

        // Use committer timestamp (when commit was created/modified) for relative time display
        let committer = commit.committer();
        let timestamp = format_timestamp(&committer.timestamp, change_id);

        let bookmarks = get_bookmarks_for_commit(repo.as_ref(), &commit_id);

        // Keep parent_ids for backward compatibility
        let parent_ids: Vec<String> = commit
            .parent_ids()
            .iter()
            .map(|id| hex::encode(&id.to_bytes()[..6]))
            .collect();

        // Build parent_edges from graph edges with type information
        let parent_edges: Vec<ParentEdge> = edges
            .iter()
            .map(|edge| ParentEdge {
                parent_id: hex::encode(&edge.target.to_bytes()[..6]),
                edge_type: match edge.edge_type {
                    GraphEdgeType::Direct => "direct",
                    GraphEdgeType::Indirect => "indirect",
                    GraphEdgeType::Missing => "missing",
                }
                .to_string(),
            })
            .collect();

        let full_change_id = format_change_id(change_id);
        let prefix_len = repo
            .shortest_unique_change_id_prefix_len(change_id)
            .unwrap_or(full_change_id.len());

        // Check if this change_id is divergent (appears multiple times)
        let count = change_id_counts.get(&full_change_id).copied().unwrap_or(1);
        let is_divergent = count > 1;
        let divergent_index = if is_divergent {
            let idx = divergent_indices.entry(full_change_id.clone()).or_insert(0);
            let current_idx = *idx;
            *idx += 1;
            Some(current_idx)
        } else {
            None
        };

        // Add /N suffix for divergent changes
        let change_id_short = if let Some(div_idx) = divergent_index {
            format!("{}/{}", &full_change_id[..prefix_len], div_idx)
        } else {
            full_change_id[..prefix_len].to_string()
        };

        let is_trunk = trunk_ancestor_ids.contains(&commit_id);

        revisions.push(Revision {
            commit_id: hex::encode(&commit_id.to_bytes()[..6]),
            change_id: full_change_id,
            change_id_short,
            parent_ids,
            parent_edges,
            description,
            author: author_name,
            timestamp,
            is_working_copy,
            is_immutable,
            is_mine,
            is_trunk,
            is_divergent,
            divergent_index,
            bookmarks,
        });
    }

    Ok(revisions)
}

fn format_change_id(change_id: &jj_lib::backend::ChangeId) -> String {
    let bytes = change_id.to_bytes();
    let mut result = String::with_capacity(12);
    for &byte in &bytes[..6] {
        let c1 = (byte >> 4) as char;
        let c2 = (byte & 0x0f) as char;
        result.push(char::from_u32(b'z' as u32 - c1 as u32).unwrap());
        result.push(char::from_u32(b'z' as u32 - c2 as u32).unwrap());
    }
    result
}

fn format_timestamp(
    timestamp: &jj_lib::backend::Timestamp,
    change_id: &jj_lib::backend::ChangeId,
) -> String {
    let change_id_str = format_change_id(change_id);
    if change_id_str == "zzzzzzzz" {
        return "root".to_string();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    // jj-lib stores timestamps in milliseconds
    let diff_ms = now - timestamp.timestamp.0;
    let diff_seconds = diff_ms.abs() / 1000;

    if diff_seconds < 60 {
        format!("{} seconds ago", diff_seconds)
    } else if diff_seconds < 3600 {
        format!("{} minutes ago", diff_seconds / 60)
    } else if diff_seconds < 86400 {
        format!("{} hours ago", diff_seconds / 3600)
    } else if diff_seconds < 604800 {
        format!("{} days ago", diff_seconds / 86400)
    } else if diff_seconds < 2592000 {
        format!("{} weeks ago", diff_seconds / 604800)
    } else if diff_seconds < 31536000 {
        format!("{} months ago", diff_seconds / 2592000)
    } else {
        format!("{} years ago", diff_seconds / 31536000)
    }
}

fn get_bookmarks_for_commit(repo: &dyn Repo, commit_id: &CommitId) -> Vec<String> {
    let view = repo.view();
    let mut bookmarks = Vec::new();

    for (name, target) in view.local_bookmarks() {
        if target.added_ids().any(|id| id == commit_id) {
            bookmarks.push(name.as_str().to_string());
        }
    }

    bookmarks
}

/// Result of resolving a revset expression
#[derive(Clone, Debug, serde::Serialize)]
pub struct RevsetResult {
    pub change_ids: Vec<String>,
    pub error: Option<String>,
}

/// Resolve a revset expression and return matching change IDs
pub fn resolve_revset(repo_path: &Path, revset_str: &str) -> Result<RevsetResult> {
    let jj_repo = JjRepo::open(repo_path)?;
    let repo = jj_repo.repo_loader().load_at_head()?;

    // Set up aliases (same as fetch_log)
    let mut aliases_map = RevsetAliasesMap::new();
    let user_email = jj_repo.user_settings().user_email();

    aliases_map.insert(
        "trunk()",
        r#"latest(
            remote_bookmarks(exact:"main", exact:"origin") |
            remote_bookmarks(exact:"master", exact:"origin") |
            remote_bookmarks(exact:"trunk", exact:"origin") |
            root()
        )"#,
    ).ok();

    aliases_map.insert("builtin_immutable_heads()", "present(trunk()) | tags() | untracked_remote_bookmarks()").ok();
    aliases_map.insert("immutable_heads()", "builtin_immutable_heads()").ok();

    let mine_revset = format!(r#"author_email(exact-i:"{}")"#, user_email);
    aliases_map.insert("mine()", &mine_revset).ok();

    let path_converter = RepoPathUiConverter::Fs {
        cwd: repo_path.to_path_buf(),
        base: repo_path.to_path_buf(),
    };
    let workspace_name = jj_repo.workspace_name();
    let workspace_ctx = RevsetWorkspaceContext {
        path_converter: &path_converter,
        workspace_name,
    };

    let context = RevsetParseContext {
        aliases_map: &aliases_map,
        local_variables: HashMap::new(),
        user_email: jj_repo.user_settings().user_email(),
        date_pattern_context: chrono::Utc::now().fixed_offset().into(),
        default_ignored_remote: Some(git::REMOTE_NAME_FOR_LOCAL_GIT_REPO),
        extensions: &RevsetExtensions::default(),
        workspace: Some(workspace_ctx),
    };

    let mut diagnostics = RevsetDiagnostics::new();
    
    // Parse the revset expression
    let expression = match parse(&mut diagnostics, revset_str, &context) {
        Ok(expr) => expr,
        Err(e) => {
            return Ok(RevsetResult {
                change_ids: vec![],
                error: Some(format!("Parse error: {}", e)),
            });
        }
    };

    // Resolve symbols
    let symbol_resolver = SymbolResolver::new(repo.as_ref(), &([] as [&Box<dyn SymbolResolverExtension>; 0]));
    let resolved = match expression.resolve_user_expression(repo.as_ref(), &symbol_resolver) {
        Ok(r) => r,
        Err(e) => {
            return Ok(RevsetResult {
                change_ids: vec![],
                error: Some(format!("Resolve error: {}", e)),
            });
        }
    };

    // Evaluate the revset
    let revset = match resolved.evaluate(repo.as_ref()) {
        Ok(r) => r,
        Err(e) => {
            return Ok(RevsetResult {
                change_ids: vec![],
                error: Some(format!("Evaluation error: {}", e)),
            });
        }
    };

    // Collect matching change IDs
    let mut change_ids = Vec::new();
    for commit_id_result in revset.iter() {
        match commit_id_result {
            Ok(commit_id) => {
                let commit = repo.store().get_commit(&commit_id)?;
                change_ids.push(format_change_id(commit.change_id()));
            }
            Err(e) => {
                return Ok(RevsetResult {
                    change_ids: vec![],
                    error: Some(format!("Iteration error: {}", e)),
                });
            }
        }
    }

    Ok(RevsetResult {
        change_ids,
        error: None,
    })
}
