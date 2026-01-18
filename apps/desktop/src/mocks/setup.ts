// Runtime mock setup - patches invoke when not running in Tauri
// NOTE: tauri-stub.ts must be imported before this to set up __TAURI_INTERNALS__

import { IS_TAURI } from "@/tauri-stub";
import type { Revision, WorkingCopyStatus, Repository, ChangedFile } from "@/schemas";

// Generate random jj-style change ID (12 characters, k-z only)
function generateChangeId(): string {
	const chars = "klmnopqrstuvwxyz";
	let result = "";
	for (let i = 0; i < 12; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

// Calculate shortest unique prefix for each change ID
function calculateShortIds(revisionsRaw: Omit<Revision, "change_id_short">[]): Revision[] {
	const changeIds = revisionsRaw.map((r) => r.change_id);
	const result: Revision[] = [];

	for (let i = 0; i < changeIds.length; i++) {
		const changeId = changeIds[i];
		let prefixLen = 1;

		// Find minimum prefix length that's unique
		while (prefixLen <= changeId.length) {
			const prefix = changeId.slice(0, prefixLen);
			const matches = changeIds.filter((id) => id.startsWith(prefix));

			// Check if this prefix is unique (only matches this change ID)
			if (matches.length === 1) {
				break;
			}

			prefixLen++;
		}

		// Handle divergent commits
		const revision = revisionsRaw[i];
		let changeIdShort: string;
		if (revision.is_divergent && revision.divergent_index !== null) {
			changeIdShort = `${changeId.slice(0, prefixLen)}/${revision.divergent_index}`;
		} else {
			changeIdShort = changeId.slice(0, prefixLen);
		}

		result.push({
			...revision,
			change_id_short: changeIdShort,
		});
	}

	return result;
}

let mockProjects: Repository[] = [
	{
		id: "mock-1",
		path: "/Users/demo/projects/tatami",
		name: "tatami",
		last_opened_at: Date.now(),
		revset_preset: null,
	},
	{
		id: "mock-2",
		path: "/Users/demo/projects/example",
		name: "example",
		last_opened_at: Date.now() - 86400000,
		revset_preset: null,
	},
];

// Complex mock revision graph representing realistic development workflow
// Structure: Multiple unmerged feature branches with 3+ commits, diverse branching patterns
// Change IDs are generated randomly (jj-style: 12 chars, k-z only)
// Short IDs are calculated as minimum unique prefixes
// Only one "main" bookmark exists on the latest main commit
const mockRevisionsRaw: Omit<Revision, "change_id_short">[] = [
	// Root commit
	{
		commit_id: "root0000000000",
		change_id: generateChangeId(),
		parent_ids: [],
		parent_edges: [],
		description: "chore: initial commit",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2592000000).toISOString(), // 30 days ago
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Main trunk commits
	{
		commit_id: "main0010000000",
		change_id: generateChangeId(),
		parent_ids: ["root0000000000"],
		parent_edges: [{ parent_id: "root0000000000", edge_type: "direct" }],
		description: "feat: initial project setup with build config",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2500000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "main0020000000",
		change_id: generateChangeId(),
		parent_ids: ["main0010000000"],
		parent_edges: [{ parent_id: "main0010000000", edge_type: "direct" }],
		description: "feat: add basic routing infrastructure",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2400000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "main0030000000",
		change_id: generateChangeId(),
		parent_ids: ["main0020000000"],
		parent_edges: [{ parent_id: "main0020000000", edge_type: "direct" }],
		description: "feat: implement core data models",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 2300000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch A: Authentication (branches from main003, 4 commits - UNMERGED)
	{
		commit_id: "auth0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0030000000"],
		parent_edges: [{ parent_id: "main0030000000", edge_type: "direct" }],
		description: "feat: add authentication service skeleton",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2200000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: true,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/auth"],
	},
	{
		commit_id: "auth0020000000",
		change_id: generateChangeId(),
		parent_ids: ["auth0010000000"],
		parent_edges: [{ parent_id: "auth0010000000", edge_type: "direct" }],
		description: "feat: implement login form component",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2100000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: true,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "auth0030000000",
		change_id: generateChangeId(),
		parent_ids: ["auth0020000000"],
		parent_edges: [{ parent_id: "auth0020000000", edge_type: "direct" }],
		description: "feat: add JWT token handling",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 2000000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: true,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "auth0040000000",
		change_id: generateChangeId(),
		parent_ids: ["auth0030000000"],
		parent_edges: [{ parent_id: "auth0030000000", edge_type: "direct" }],
		description: "feat: add password reset flow",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 1900000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: true,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch B: Dark mode (branches from main003, 5 commits - UNMERGED)
	{
		commit_id: "dark0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0030000000"],
		parent_edges: [{ parent_id: "main0030000000", edge_type: "direct" }],
		description: "feat: add theme provider infrastructure",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 2150000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/dark-mode"],
	},
	{
		commit_id: "dark0020000000",
		change_id: generateChangeId(),
		parent_ids: ["dark0010000000"],
		parent_edges: [{ parent_id: "dark0010000000", edge_type: "direct" }],
		description: "feat: implement dark mode toggle component",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 2050000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "dark0030000000",
		change_id: generateChangeId(),
		parent_ids: ["dark0020000000"],
		parent_edges: [{ parent_id: "dark0020000000", edge_type: "direct" }],
		description: "feat: add dark mode styles for all components",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 1950000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "dark0040000000",
		change_id: generateChangeId(),
		parent_ids: ["dark0030000000"],
		parent_edges: [{ parent_id: "dark0030000000", edge_type: "direct" }],
		description: "feat: add system theme detection",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 1850000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "dark0050000000",
		change_id: generateChangeId(),
		parent_ids: ["dark0040000000"],
		parent_edges: [{ parent_id: "dark0040000000", edge_type: "direct" }],
		description: "fix: improve contrast ratios for accessibility",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 1750000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Main trunk continues
	{
		commit_id: "main0040000000",
		change_id: generateChangeId(),
		parent_ids: ["main0030000000"],
		parent_edges: [{ parent_id: "main0030000000", edge_type: "direct" }],
		description: "fix: resolve race condition in data fetching",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 1800000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "main0050000000",
		change_id: generateChangeId(),
		parent_ids: ["main0040000000"],
		parent_edges: [{ parent_id: "main0040000000", edge_type: "direct" }],
		description: "refactor: extract shared utilities into separate module",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 1700000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch C: Performance (branches from main005, 4 commits - UNMERGED)
	{
		commit_id: "perf0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0050000000"],
		parent_edges: [{ parent_id: "main0050000000", edge_type: "direct" }],
		description: "perf: optimize database queries",
		author: "david@example.com",
		timestamp: new Date(Date.now() - 1600000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/performance"],
	},
	{
		commit_id: "perf0020000000",
		change_id: generateChangeId(),
		parent_ids: ["perf0010000000"],
		parent_edges: [{ parent_id: "perf0010000000", edge_type: "direct" }],
		description: "perf: add query result caching layer",
		author: "david@example.com",
		timestamp: new Date(Date.now() - 1500000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "perf0030000000",
		change_id: generateChangeId(),
		parent_ids: ["perf0020000000"],
		parent_edges: [{ parent_id: "perf0020000000", edge_type: "direct" }],
		description: "perf: implement lazy loading for large datasets",
		author: "david@example.com",
		timestamp: new Date(Date.now() - 1400000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "perf0040000000",
		change_id: generateChangeId(),
		parent_ids: ["perf0030000000"],
		parent_edges: [{ parent_id: "perf0030000000", edge_type: "direct" }],
		description: "perf: add connection pooling for database",
		author: "david@example.com",
		timestamp: new Date(Date.now() - 1300000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Main trunk continues
	{
		commit_id: "main0060000000",
		change_id: generateChangeId(),
		parent_ids: ["main0050000000"],
		parent_edges: [{ parent_id: "main0050000000", edge_type: "direct" }],
		description: "docs: update API documentation",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 1200000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "main0070000000",
		change_id: generateChangeId(),
		parent_ids: ["main0060000000"],
		parent_edges: [{ parent_id: "main0060000000", edge_type: "direct" }],
		description: "chore: update dependencies",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 1100000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch D: API improvements (branches from main007, 3 commits - UNMERGED)
	{
		commit_id: "api0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0070000000"],
		parent_edges: [{ parent_id: "main0070000000", edge_type: "direct" }],
		description: "feat: add REST API endpoint for user management",
		author: "eve@example.com",
		timestamp: new Date(Date.now() - 1000000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/api"],
	},
	{
		commit_id: "api0020000000",
		change_id: generateChangeId(),
		parent_ids: ["api0010000000"],
		parent_edges: [{ parent_id: "api0010000000", edge_type: "direct" }],
		description: "feat: add request validation middleware",
		author: "eve@example.com",
		timestamp: new Date(Date.now() - 900000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "api0030000000",
		change_id: generateChangeId(),
		parent_ids: ["api0020000000"],
		parent_edges: [{ parent_id: "api0020000000", edge_type: "direct" }],
		description: "feat: add pagination support for list endpoints",
		author: "eve@example.com",
		timestamp: new Date(Date.now() - 800000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch E: Testing (branches from main007, 5 commits - UNMERGED)
	{
		commit_id: "test0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0070000000"],
		parent_edges: [{ parent_id: "main0070000000", edge_type: "direct" }],
		description: "test: add unit tests for core utilities",
		author: "frank@example.com",
		timestamp: new Date(Date.now() - 950000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/testing"],
	},
	{
		commit_id: "test0020000000",
		change_id: generateChangeId(),
		parent_ids: ["test0010000000"],
		parent_edges: [{ parent_id: "test0010000000", edge_type: "direct" }],
		description: "test: add integration tests for API endpoints",
		author: "frank@example.com",
		timestamp: new Date(Date.now() - 850000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "test0030000000",
		change_id: generateChangeId(),
		parent_ids: ["test0020000000"],
		parent_edges: [{ parent_id: "test0020000000", edge_type: "direct" }],
		description: "test: add end-to-end tests for critical flows",
		author: "frank@example.com",
		timestamp: new Date(Date.now() - 750000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "test0040000000",
		change_id: generateChangeId(),
		parent_ids: ["test0030000000"],
		parent_edges: [{ parent_id: "test0030000000", edge_type: "direct" }],
		description: "test: add performance benchmarks",
		author: "frank@example.com",
		timestamp: new Date(Date.now() - 650000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "test0050000000",
		change_id: generateChangeId(),
		parent_ids: ["test0040000000"],
		parent_edges: [{ parent_id: "test0040000000", edge_type: "direct" }],
		description: "test: add test coverage reporting",
		author: "frank@example.com",
		timestamp: new Date(Date.now() - 550000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Main trunk continues
	{
		commit_id: "main0080000000",
		change_id: generateChangeId(),
		parent_ids: ["main0070000000"],
		parent_edges: [{ parent_id: "main0070000000", edge_type: "direct" }],
		description: "fix: handle edge case in form validation",
		author: "henry@example.com",
		timestamp: new Date(Date.now() - 700000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch F: UI improvements (branches from main008, 4 commits - UNMERGED)
	{
		commit_id: "ui0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0080000000"],
		parent_edges: [{ parent_id: "main0080000000", edge_type: "direct" }],
		description: "feat: redesign navigation component",
		author: "grace@example.com",
		timestamp: new Date(Date.now() - 600000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/ui"],
	},
	{
		commit_id: "ui0020000000",
		change_id: generateChangeId(),
		parent_ids: ["ui0010000000"],
		parent_edges: [{ parent_id: "ui0010000000", edge_type: "direct" }],
		description: "feat: add responsive layout breakpoints",
		author: "grace@example.com",
		timestamp: new Date(Date.now() - 500000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "ui0030000000",
		change_id: generateChangeId(),
		parent_ids: ["ui0020000000"],
		parent_edges: [{ parent_id: "ui0020000000", edge_type: "direct" }],
		description: "feat: add loading states and skeletons",
		author: "grace@example.com",
		timestamp: new Date(Date.now() - 400000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "ui0040000000",
		change_id: generateChangeId(),
		parent_ids: ["ui0030000000"],
		parent_edges: [{ parent_id: "ui0030000000", edge_type: "direct" }],
		description: "feat: improve accessibility with ARIA labels",
		author: "grace@example.com",
		timestamp: new Date(Date.now() - 300000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch G: Security (branches from main008, 3 commits - UNMERGED)
	{
		commit_id: "sec0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0080000000"],
		parent_edges: [{ parent_id: "main0080000000", edge_type: "direct" }],
		description: "security: add input sanitization",
		author: "iris@example.com",
		timestamp: new Date(Date.now() - 550000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/security"],
	},
	{
		commit_id: "sec0020000000",
		change_id: generateChangeId(),
		parent_ids: ["sec0010000000"],
		parent_edges: [{ parent_id: "sec0010000000", edge_type: "direct" }],
		description: "security: implement rate limiting",
		author: "iris@example.com",
		timestamp: new Date(Date.now() - 450000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "sec0030000000",
		change_id: generateChangeId(),
		parent_ids: ["sec0020000000"],
		parent_edges: [{ parent_id: "sec0020000000", edge_type: "direct" }],
		description: "security: add CSRF protection",
		author: "iris@example.com",
		timestamp: new Date(Date.now() - 350000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch H: Documentation (branches from main008, 4 commits - UNMERGED)
	{
		commit_id: "doc0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0080000000"],
		parent_edges: [{ parent_id: "main0080000000", edge_type: "direct" }],
		description: "docs: add architecture decision records",
		author: "lisa@example.com",
		timestamp: new Date(Date.now() - 480000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/docs"],
	},
	{
		commit_id: "doc0020000000",
		change_id: generateChangeId(),
		parent_ids: ["doc0010000000"],
		parent_edges: [{ parent_id: "doc0010000000", edge_type: "direct" }],
		description: "docs: add API reference documentation",
		author: "lisa@example.com",
		timestamp: new Date(Date.now() - 380000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "doc0030000000",
		change_id: generateChangeId(),
		parent_ids: ["doc0020000000"],
		parent_edges: [{ parent_id: "doc0020000000", edge_type: "direct" }],
		description: "docs: add deployment guide",
		author: "lisa@example.com",
		timestamp: new Date(Date.now() - 280000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "doc0040000000",
		change_id: generateChangeId(),
		parent_ids: ["doc0030000000"],
		parent_edges: [{ parent_id: "doc0030000000", edge_type: "direct" }],
		description: "docs: add troubleshooting section",
		author: "lisa@example.com",
		timestamp: new Date(Date.now() - 180000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Feature branch I: Monitoring (branches from main003, older branch - 3 commits - UNMERGED)
	{
		commit_id: "mon0010000000",
		change_id: generateChangeId(),
		parent_ids: ["main0030000000"],
		parent_edges: [{ parent_id: "main0030000000", edge_type: "direct" }],
		description: "feat: add application monitoring setup",
		author: "jack@example.com",
		timestamp: new Date(Date.now() - 2000000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["feature/monitoring"],
	},
	{
		commit_id: "mon0020000000",
		change_id: generateChangeId(),
		parent_ids: ["mon0010000000"],
		parent_edges: [{ parent_id: "mon0010000000", edge_type: "direct" }],
		description: "feat: add error tracking integration",
		author: "jack@example.com",
		timestamp: new Date(Date.now() - 1900000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	{
		commit_id: "mon0030000000",
		change_id: generateChangeId(),
		parent_ids: ["mon0020000000"],
		parent_edges: [{ parent_id: "mon0020000000", edge_type: "direct" }],
		description: "feat: add performance metrics dashboard",
		author: "jack@example.com",
		timestamp: new Date(Date.now() - 1800000000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		is_mine: false,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Main trunk continues
	{
		commit_id: "main0090000000",
		change_id: generateChangeId(),
		parent_ids: ["main0080000000"],
		parent_edges: [{ parent_id: "main0080000000", edge_type: "direct" }],
		description: "fix: resolve memory leak in event handlers",
		author: "henry@example.com",
		timestamp: new Date(Date.now() - 200000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
	// Current working copy (on main009) - only "main" bookmark exists here
	{
		commit_id: "main0100000000",
		change_id: generateChangeId(),
		parent_ids: ["main0090000000"],
		parent_edges: [{ parent_id: "main0090000000", edge_type: "direct" }],
		description: "chore: prepare for release",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 100000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		is_mine: false,
		is_trunk: true,
		is_divergent: false,
		divergent_index: null,
		bookmarks: ["main"], // Only "main" bookmark
	},
	// Current working copy (on main010)
	{
		commit_id: "wc00100000000",
		change_id: generateChangeId(),
		parent_ids: ["main0100000000"],
		parent_edges: [{ parent_id: "main0100000000", edge_type: "direct" }],
		description: "",
		author: "alice@example.com",
		timestamp: new Date().toISOString(),
		is_working_copy: true,
		is_immutable: false,
		is_mine: true,
		is_trunk: false,
		is_divergent: false,
		divergent_index: null,
		bookmarks: [],
	},
];

// Calculate shortest unique prefixes for all change IDs
// Made mutable so mutation handlers can update it
let mockRevisions: Revision[] = calculateShortIds(mockRevisionsRaw);

const mockChangedFiles: ChangedFile[] = [
	{ path: "src/main.rs", status: "modified" },
	{ path: "README.md", status: "added" },
];

type MockHandler = (args: Record<string, unknown>) => unknown;

const handlers: Record<string, MockHandler> = {
	get_projects: () => mockProjects,
	upsert_project: (args) => {
		const project = args.project as Repository;
		const existingIndex = mockProjects.findIndex((p) => p.id === project.id);
		if (existingIndex >= 0) {
			mockProjects[existingIndex] = project;
		} else {
			mockProjects = [project, ...mockProjects];
		}
		return undefined;
	},
	remove_project: (args) => {
		const projectId = args.projectId as string;
		mockProjects = mockProjects.filter((p) => p.id !== projectId);
		return undefined;
	},
	find_project_by_path: (args) => {
		const path = args.path as string;
		return mockProjects.find((p) => p.path === path) ?? null;
	},
	find_repository: () => "/Users/demo/projects/tatami",
	get_revisions: () => {
		console.log("[Mock] get_revisions called, returning", mockRevisions.length, "revisions");
		return mockRevisions;
	},
	get_status: (): WorkingCopyStatus => {
		const wc = mockRevisions.find((r) => r.is_working_copy);
		return {
			repo_path: "/Users/demo/projects/tatami",
			change_id: wc?.change_id ?? "klnmopqrstuv",
			files: mockChangedFiles,
		};
	},
	get_file_diff: (): string => `--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
-    println!("old");
+    println!("new");
+    println!("extra");
 }`,
	get_revision_diff: (): string => `--- a/src/main.rs
+++ b/src/main.rs
@@ -1,3 +1,4 @@
 fn main() {
-    println!("old");
+    println!("new");
+    println!("extra");
 }
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Example Project
+This is a new line
 Welcome to the project`,
	get_revision_changes: (): ChangedFile[] => mockChangedFiles,
	watch_repository: () => undefined,
	unwatch_repository: () => undefined,
	generate_change_ids: (args) => {
		const count = (args.count as number) ?? 10;
		return Array.from({ length: count }, () => generateChangeId());
	},
	jj_new: (args) => {
		const parentChangeIds = args.parentChangeIds as string[];
		const providedChangeId = args.changeId as string | null;

		// Find parent revisions by change_id (handling short IDs)
		const parentRevisions = parentChangeIds
			.map((id) =>
				mockRevisions.find((r) => r.change_id.startsWith(id) || r.change_id_short === id),
			)
			.filter((r): r is Revision => r !== undefined);

		// Get parent commit IDs for the new revision
		const parentCommitIds = parentRevisions.map((r) => r.commit_id);

		// Find current working copy and clear its flag
		const currentWcIndex = mockRevisions.findIndex((r) => r.is_working_copy);
		if (currentWcIndex >= 0) {
			mockRevisions[currentWcIndex] = { ...mockRevisions[currentWcIndex], is_working_copy: false };
		}

		// Use provided change ID or generate new one
		const newChangeId = providedChangeId ?? generateChangeId();
		const newCommitId = `new${Date.now().toString(16).slice(-10)}`;
		const newRevision: Omit<Revision, "change_id_short"> = {
			commit_id: newCommitId,
			change_id: newChangeId,
			parent_ids: parentCommitIds,
			parent_edges: parentCommitIds.map((id) => ({ parent_id: id, edge_type: "direct" as const })),
			description: "",
			author: "alice@example.com",
			timestamp: new Date().toISOString(),
			is_working_copy: true,
			is_immutable: false,
			is_mine: true,
			is_trunk: false,
			is_divergent: false,
			divergent_index: null,
			bookmarks: [],
		};

		// Recalculate short IDs with new revision included
		const allRevisionsRaw = [
			...mockRevisions.map(({ change_id_short: _, ...r }) => r),
			newRevision,
		];
		mockRevisions = calculateShortIds(allRevisionsRaw);

		// Return the change ID (matching real backend behavior)
		return newChangeId;
	},
	jj_edit: (args) => {
		const changeId = args.changeId as string;
		console.log("[Mock] jj_edit called with changeId:", changeId);
		// Find target revision by change_id (handling short IDs)
		const targetIndex = mockRevisions.findIndex(
			(r) => r.change_id.startsWith(changeId) || r.change_id_short === changeId,
		);
		if (targetIndex < 0) {
			console.warn(`[Mock] jj_edit: revision not found: ${changeId}`);
			return undefined;
		}

		console.log("[Mock] jj_edit: found revision at index", targetIndex);

		// Clear working copy from all revisions, set on target
		mockRevisions = mockRevisions.map((r, i) => ({
			...r,
			is_working_copy: i === targetIndex,
		}));

		console.log(
			"[Mock] jj_edit: updated mockRevisions, new WC:",
			mockRevisions.find((r) => r.is_working_copy)?.change_id_short,
		);

		return undefined;
	},
	jj_abandon: (args) => {
		const changeId = args.changeId as string;
		// Find revision by change_id (handling short IDs)
		const revisionIndex = mockRevisions.findIndex(
			(r) => r.change_id.startsWith(changeId) || r.change_id_short === changeId,
		);
		if (revisionIndex < 0) {
			console.warn(`[Mock] jj_abandon: revision not found: ${changeId}`);
			return undefined;
		}

		const revision = mockRevisions[revisionIndex];

		if (revision.is_working_copy) {
			// Abandoning WC creates a new WC on the parent
			// Clear WC flag and create a new working copy
			const parentCommitId = revision.parent_ids[0];
			// Remove the abandoned revision
			mockRevisions = mockRevisions.filter((_, i) => i !== revisionIndex);

			// Create new working copy on parent
			const newChangeId = generateChangeId();
			const newCommitId = `wc${Date.now().toString(16).slice(-10)}`;
			const newRevision: Omit<Revision, "change_id_short"> = {
				commit_id: newCommitId,
				change_id: newChangeId,
				parent_ids: parentCommitId ? [parentCommitId] : [],
				parent_edges: parentCommitId
					? [{ parent_id: parentCommitId, edge_type: "direct" as const }]
					: [],
				description: "",
				author: "alice@example.com",
				timestamp: new Date().toISOString(),
				is_working_copy: true,
				is_immutable: false,
				is_mine: true,
				is_trunk: false,
				is_divergent: false,
				divergent_index: null,
				bookmarks: [],
			};

			// Recalculate short IDs
			const allRevisionsRaw = [
				...mockRevisions.map(({ change_id_short: _, ...r }) => r),
				newRevision,
			];
			mockRevisions = calculateShortIds(allRevisionsRaw);
		} else {
			// Just remove the revision
			mockRevisions = mockRevisions.filter((_, i) => i !== revisionIndex);
			// Recalculate short IDs after removal
			const allRevisionsRaw = mockRevisions.map(({ change_id_short: _, ...r }) => r);
			mockRevisions = calculateShortIds(allRevisionsRaw);
		}

		return undefined;
	},
	get_commit_recency: () => ({}),
	resolve_revset: (args) => {
		const revset = args.revset as string;
		// Simple mock implementation for common revsets
		if (revset === "@") {
			const wc = mockRevisions.find((r) => r.is_working_copy);
			return { change_ids: wc ? [wc.change_id] : [], error: null };
		}
		if (revset === "@-") {
			const wc = mockRevisions.find((r) => r.is_working_copy);
			if (wc && wc.parent_ids.length > 0) {
				// Find parent by commit_id
				const parent = mockRevisions.find((r) => r.commit_id === wc.parent_ids[0]);
				return { change_ids: parent ? [parent.change_id] : [], error: null };
			}
			return { change_ids: [], error: null };
		}
		// Default: return all revisions (mock doesn't implement full revset)
		return { change_ids: mockRevisions.map((r) => r.change_id), error: null };
	},

	// Plugin commands
	"plugin:window|set_title": () => undefined,
	"plugin:event|listen": () => 0, // Returns listener ID
	"plugin:event|unlisten": () => undefined,
	"plugin:path|home_dir": () => "/Users/demo",
	"plugin:dialog|open": () => null, // User cancelled
};

export async function setupMocks(): Promise<void> {
	if (IS_TAURI) {
		console.log("[Mocks] Running in Tauri, skipping mock setup");
		return;
	}

	console.log("[Mocks] Not in Tauri, setting up IPC mocks...");

	// Dynamically import to avoid loading in Tauri
	const { mockIPC } = await import("@tauri-apps/api/mocks");

	mockIPC((cmd, args) => {
		console.log(`[Mock] IPC call: ${cmd}`, args);
		const handler = handlers[cmd];
		if (!handler) {
			console.warn(`[Mock] No handler for command: ${cmd}`, args);
			return undefined;
		}
		try {
			const result = handler((args ?? {}) as Record<string, unknown>);
			console.log(`[Mock] IPC result for ${cmd}:`, result);
			return result;
		} catch (error) {
			console.error(`[Mock] IPC error for ${cmd}:`, error);
			throw error;
		}
	});

	console.log("[Mocks] IPC mocks ready");
}
