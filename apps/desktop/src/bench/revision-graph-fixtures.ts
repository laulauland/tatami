import type { Revision } from "@/tauri-commands";

export interface GraphFixture {
  name: string;
  description: string;
  revisionCount: number;
  revisions: Revision[];
}

let changeIdCounter = 0;
let commitIdCounter = 0;

function nextChangeId(): string {
  return `v${(changeIdCounter++).toString(36).padStart(4, "0")}`;
}

function nextCommitId(): string {
  return `c${(commitIdCounter++).toString(36).padStart(6, "0")}`;
}

function makeRevision(
  overrides: Partial<Revision> & { commit_id: string; change_id: string },
): Revision {
  return {
    change_id: overrides.change_id,
    change_id_short: overrides.change_id.slice(0, 4),
    commit_id: overrides.commit_id,
    children_ids: overrides.children_ids ?? [],
    description: overrides.description ?? `Revision ${overrides.change_id}`,
    author: "bench@tatami.dev",
    timestamp: "2024-01-01",
    is_working_copy: overrides.is_working_copy ?? false,
    is_trunk: overrides.is_trunk ?? false,
    is_immutable: overrides.is_immutable ?? false,
    is_divergent: overrides.is_divergent ?? false,
    is_mine: overrides.is_mine ?? false,
    has_conflict: overrides.has_conflict ?? false,
    bookmarks: overrides.bookmarks ?? [],
    parent_edges: overrides.parent_edges ?? [],
    divergent_index: overrides.divergent_index ?? null,
  };
}

/**
 * Linear chain: N revisions in a straight line.
 * This is the simplest case and stresses the ancestry walk/stack detection.
 */
export function linearChainFixture(n: number): GraphFixture {
  changeIdCounter = 0;
  commitIdCounter = 0;
  const revisions: Revision[] = [];
  let prevCommitId: string | null = null;

  for (let i = 0; i < n; i++) {
    const changeId = nextChangeId();
    const commitId = nextCommitId();
    const parentEdges = prevCommitId
      ? [{ parent_id: prevCommitId, edge_type: "direct" as const }]
      : [];
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        is_working_copy: i === 0,
        is_trunk: i >= n - 5,
        is_immutable: i >= n - 5,
        parent_edges: parentEdges,
      }),
    );
    prevCommitId = commitId;
  }

  return {
    name: `linear-${n}`,
    description: `Linear chain of ${n} revisions`,
    revisionCount: n,
    revisions,
  };
}

/**
 * Many short branches: trunk with many small feature branches (1-3 commits each).
 * Stresses lane allocation and edge routing.
 */
export function manyShortBranchesFixture(n: number): GraphFixture {
  changeIdCounter = 0;
  commitIdCounter = 0;
  const revisions: Revision[] = [];

  // Trunk commits
  const trunkCount = Math.max(1, Math.floor(n * 0.3));
  const trunkCommitIds: string[] = [];
  let prevTrunkId: string | null = null;

  for (let i = 0; i < trunkCount; i++) {
    const changeId = nextChangeId();
    const commitId = nextCommitId();
    const parentEdges = prevTrunkId
      ? [{ parent_id: prevTrunkId, edge_type: "direct" as const }]
      : [];
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        is_trunk: true,
        is_immutable: true,
        parent_edges: parentEdges,
      }),
    );
    trunkCommitIds.push(commitId);
    prevTrunkId = commitId;
  }

  // Feature branches off trunk commits
  const remaining = n - trunkCount;
  let branchId = 0;
  while (remaining > revisions.length - trunkCount) {
    const trunkIdx = branchId % trunkCount;
    const branchBase = trunkCommitIds[trunkIdx];
    const branchLength = 1 + Math.floor(Math.random() * 2);
    let prevId = branchBase;
    for (let j = 0; j < branchLength && revisions.length < n; j++) {
      const changeId = nextChangeId();
      const commitId = nextCommitId();
      revisions.push(
        makeRevision({
          change_id: changeId,
          commit_id: commitId,
          is_working_copy: revisions.length === 0,
          parent_edges: [{ parent_id: prevId, edge_type: "direct" as const }],
        }),
      );
      prevId = commitId;
    }
    branchId++;
  }

  return {
    name: `many-branches-${n}`,
    description: `${trunkCount} trunk commits + ${n - trunkCount} short feature branches`,
    revisionCount: n,
    revisions,
  };
}

/**
 * Long branch with collapsed stacks: trunk + one very long branch.
 * Stresses stack detection and collapsed stack rendering.
 */
export function longBranchWithStacksFixture(n: number): GraphFixture {
  changeIdCounter = 0;
  commitIdCounter = 0;
  const revisions: Revision[] = [];

  const trunkCount = Math.max(3, Math.floor(n * 0.1));
  const trunkCommitIds: string[] = [];
  let prevTrunkId: string | null = null;

  for (let i = 0; i < trunkCount; i++) {
    const changeId = nextChangeId();
    const commitId = nextCommitId();
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        is_trunk: true,
        is_immutable: true,
        parent_edges: prevTrunkId
          ? [{ parent_id: prevTrunkId, edge_type: "direct" as const }]
          : [],
      }),
    );
    trunkCommitIds.push(commitId);
    prevTrunkId = commitId;
  }

  // One long branch off the latest trunk
  const branchLength = n - trunkCount;
  let prevId = trunkCommitIds[trunkCommitIds.length - 1];
  for (let i = 0; i < branchLength; i++) {
    const changeId = nextChangeId();
    const commitId = nextCommitId();
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        is_working_copy: i === 0,
        parent_edges: [{ parent_id: prevId, edge_type: "direct" as const }],
      }),
    );
    prevId = commitId;
  }

  return {
    name: `long-branch-stacks-${n}`,
    description: `${trunkCount} trunk + ${branchLength}-commit feature branch`,
    revisionCount: n,
    revisions,
  };
}

/**
 * Merge-heavy graph: many merge commits connecting branches back to trunk.
 * Stresses edge routing with cross-lane edges.
 */
export function mergeHeavyFixture(n: number): GraphFixture {
  changeIdCounter = 0;
  commitIdCounter = 0;
  const revisions: Revision[] = [];

  const trunkCount = Math.max(3, Math.floor(n * 0.2));
  const trunkCommitIds: string[] = [];
  let prevTrunkId: string | null = null;

  for (let i = 0; i < trunkCount; i++) {
    const changeId = nextChangeId();
    const commitId = nextCommitId();
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        is_trunk: true,
        is_immutable: true,
        parent_edges: prevTrunkId
          ? [{ parent_id: prevTrunkId, edge_type: "direct" as const }]
          : [],
      }),
    );
    trunkCommitIds.push(commitId);
    prevTrunkId = commitId;
  }

  // Create branches that merge back
  const branchCount = Math.floor((n - trunkCount) / 3);
  let created = trunkCount;
  for (let b = 0; b < branchCount && created < n; b++) {
    const trunkIdx = Math.floor(Math.random() * trunkCount);
    const trunkId = trunkCommitIds[trunkIdx];
    const changeId = nextChangeId();
    const commitId = nextCommitId();

    // Branch commit
    revisions.push(
      makeRevision({
        change_id: changeId,
        commit_id: commitId,
        parent_edges: [{ parent_id: trunkId, edge_type: "direct" as const }],
      }),
    );
    created++;

    // Merge back to trunk (if there's a next trunk commit)
    if (trunkIdx + 1 < trunkCount && created < n) {
      const mergeChangeId = nextChangeId();
      const mergeCommitId = nextCommitId();
      revisions.push(
        makeRevision({
          change_id: mergeChangeId,
          commit_id: mergeCommitId,
          parent_edges: [
            { parent_id: commitId, edge_type: "direct" as const },
            { parent_id: trunkCommitIds[trunkIdx + 1], edge_type: "direct" as const },
          ],
        }),
      );
      created++;
    }
  }

  return {
    name: `merge-heavy-${n}`,
    description: `Trunk with ${branchCount} merge-back branches`,
    revisionCount: revisions.length,
    revisions,
  };
}

export const ALL_FIXTURE_NAMES = [
  "linear-100",
  "linear-1000",
  "linear-5000",
  "linear-10000",
  "many-branches-1000",
  "many-branches-5000",
  "long-branch-stacks-1000",
  "long-branch-stacks-5000",
  "merge-heavy-1000",
  "merge-heavy-5000",
] as const;

export function getFixture(name: string): GraphFixture {
  const lastDash = name.lastIndexOf("-");
  const shape = name.slice(0, lastDash);
  const sizeStr = name.slice(lastDash + 1);
  const size = Number.parseInt(sizeStr, 10);
  if (Number.isNaN(size)) throw new Error(`Unknown fixture: ${name}`);

  switch (shape) {
    case "linear":
      return linearChainFixture(size);
    case "many-branches":
      return manyShortBranchesFixture(size);
    case "long-branch-stacks":
      return longBranchWithStacksFixture(size);
    case "merge-heavy":
      return mergeHeavyFixture(size);
    default:
      throw new Error(`Unknown fixture shape: ${shape}`);
  }
}
