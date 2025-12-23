use anyhow::{Context, Result};
use jj_lib::backend::CommitId;
use jj_lib::git;
use jj_lib::graph::{GraphEdge, GraphEdgeType};
use jj_lib::object_id::ObjectId;
use jj_lib::repo::Repo;
use jj_lib::revset::{
    parse, RevsetAliasesMap, RevsetDiagnostics, RevsetExpression, RevsetExtensions,
    RevsetParseContext, SymbolResolver, SymbolResolverExtension,
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
    pub bookmarks: Vec<String>,
}

pub fn fetch_log(repo_path: &Path, limit: usize, revset: Option<&str>) -> Result<Vec<Revision>> {
    let jj_repo = JjRepo::open(repo_path)?;
    let repo = jj_repo.repo_loader().load_at_head()?;
    let user_email = jj_repo.user_settings().user_email();

    let wc_id = repo
        .view()
        .wc_commit_ids()
        .values()
        .next()
        .context("No working copy")?;

    let revset_expression = if let Some(revset_str) = revset {
        // Parse and evaluate custom revset
        let context = RevsetParseContext {
            aliases_map: &RevsetAliasesMap::default(),
            local_variables: HashMap::new(),
            user_email: "",
            date_pattern_context: chrono::Utc::now().fixed_offset().into(),
            default_ignored_remote: Some(git::REMOTE_NAME_FOR_LOCAL_GIT_REPO),
            extensions: &RevsetExtensions::default(),
            workspace: None,
        };

        let mut diagnostics = RevsetDiagnostics::new();
        let expression = parse(&mut diagnostics, revset_str, &context)
            .context("Failed to parse revset")?;

        let symbol_resolver = SymbolResolver::new(repo.as_ref(), &([] as [&Box<dyn SymbolResolverExtension>; 0]));
        let resolved = expression.resolve_user_expression(repo.as_ref(), &symbol_resolver)
            .context("Failed to resolve revset")?;

        resolved.evaluate(repo.as_ref())
            .context("Failed to evaluate revset")?
    } else {
        // Default revset: all commits reachable from visible heads
        // TODO: Use more sophisticated default: present(@) | ancestors(immutable_heads().., 2) | present(trunk())
        RevsetExpression::visible_heads()
            .ancestors()
            .evaluate(repo.as_ref())
            .context("Failed to evaluate default revset")?
    };

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

    let mut revisions = Vec::new();

    for (commit_id, edges) in graph_nodes {
        let commit = repo.store().get_commit(&commit_id)?;
        let change_id = commit.change_id();
        let is_working_copy = wc_id == &commit_id;
        let is_immutable = immutable_ids.contains(&commit_id);

        let description = commit.description().to_string();
        let first_line = description
            .lines()
            .next()
            .unwrap_or("(no description)")
            .to_string();

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
        let change_id_short = full_change_id[..prefix_len].to_string();

        revisions.push(Revision {
            commit_id: hex::encode(&commit_id.to_bytes()[..6]),
            change_id: full_change_id,
            change_id_short,
            parent_ids,
            parent_edges,
            description: first_line,
            author: author_name,
            timestamp,
            is_working_copy,
            is_immutable,
            is_mine,
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
