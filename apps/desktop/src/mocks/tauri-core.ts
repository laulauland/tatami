// Mock invoke for browser development - swapped in by Vite when TAURI_DEV_HOST is not set

interface Revision {
	commit_id: string;
	change_id: string;
	change_id_short: string;
	parent_ids: string[];
	description: string;
	author: string;
	timestamp: string;
	is_working_copy: boolean;
	is_immutable: boolean;
	bookmarks: string[];
}

interface Project {
	id: string;
	path: string;
	name: string;
	last_opened_at: number;
}

interface WorkingCopyStatus {
	repo_path: string;
	change_id: string;
	files: { path: string; status: "added" | "modified" | "deleted" }[];
}

interface FileDiff {
	path: string;
	hunks: {
		old_start: number;
		old_count: number;
		new_start: number;
		new_count: number;
		lines: {
			line_type: "context" | "add" | "remove";
			content: string;
			old_line_number: number | null;
			new_line_number: number | null;
		}[];
	}[];
}

const mockProjects: Project[] = [
	{
		id: "mock-1",
		path: "/Users/demo/projects/tatami",
		name: "tatami",
		last_opened_at: Date.now(),
	},
	{
		id: "mock-2",
		path: "/Users/demo/projects/example",
		name: "example",
		last_opened_at: Date.now() - 86400000,
	},
];

const mockRevisions: Revision[] = [
	{
		commit_id: "a1b2c3d4e5f6",
		change_id: "wc001",
		change_id_short: "wc0",
		parent_ids: ["b2c3d4e5f6a1"],
		description: "",
		author: "alice@example.com",
		timestamp: new Date().toISOString(),
		is_working_copy: true,
		is_immutable: false,
		bookmarks: [],
	},
	{
		commit_id: "b2c3d4e5f6a1",
		change_id: "feat01",
		change_id_short: "fe1",
		parent_ids: ["c3d4e5f6a1b2"],
		description: "feat: add user authentication flow",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 1800000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		bookmarks: ["feature/auth"],
	},
	{
		commit_id: "c3d4e5f6a1b2",
		change_id: "feat02",
		change_id_short: "fe2",
		parent_ids: ["d4e5f6a1b2c3"],
		description: "feat: implement login form component",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 3600000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		bookmarks: [],
	},
	{
		commit_id: "d4e5f6a1b2c3",
		change_id: "fix001",
		change_id_short: "fx1",
		parent_ids: ["e5f6a1b2c3d4"],
		description: "fix: resolve race condition in data fetching",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 7200000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		bookmarks: [],
	},
	{
		commit_id: "e5f6a1b2c3d4",
		change_id: "refac1",
		change_id_short: "rf1",
		parent_ids: ["f6a1b2c3d4e5"],
		description: "refactor: extract shared utilities into separate module",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 14400000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		bookmarks: [],
	},
	{
		commit_id: "f6a1b2c3d4e5",
		change_id: "docs01",
		change_id_short: "dc1",
		parent_ids: ["a1b2c3d4e5f7"],
		description: "docs: update API documentation",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 28800000).toISOString(),
		is_working_copy: false,
		is_immutable: false,
		bookmarks: [],
	},
	{
		commit_id: "a1b2c3d4e5f7",
		change_id: "merge1",
		change_id_short: "mg1",
		parent_ids: ["b2c3d4e5f7a1", "x1y2z3a4b5c6"],
		description: "merge: integrate feature branch",
		author: "bob@example.com",
		timestamp: new Date(Date.now() - 43200000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		bookmarks: ["main"],
	},
	{
		commit_id: "x1y2z3a4b5c6",
		change_id: "side01",
		change_id_short: "sd1",
		parent_ids: ["b2c3d4e5f7a1"],
		description: "feat: add dark mode support",
		author: "charlie@example.com",
		timestamp: new Date(Date.now() - 50000000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		bookmarks: [],
	},
	{
		commit_id: "b2c3d4e5f7a1",
		change_id: "init01",
		change_id_short: "in1",
		parent_ids: ["c3d4e5f7a1b2"],
		description: "feat: initial project setup with build config",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 86400000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		bookmarks: [],
	},
	{
		commit_id: "c3d4e5f7a1b2",
		change_id: "root00",
		change_id_short: "rt0",
		parent_ids: [],
		description: "chore: initial commit",
		author: "alice@example.com",
		timestamp: new Date(Date.now() - 172800000).toISOString(),
		is_working_copy: false,
		is_immutable: true,
		bookmarks: [],
	},
];

const handlers: Record<string, (args?: unknown) => unknown> = {
	get_projects: () => mockProjects,
	upsert_project: () => undefined,
	find_project_by_path: (args) => {
		const { path } = args as { path: string };
		return mockProjects.find((p) => p.path === path) ?? null;
	},
	find_repository: () => "/Users/demo/projects/tatami",
	get_revisions: () => mockRevisions,
	get_status: (): WorkingCopyStatus => ({
		repo_path: "/Users/demo/projects/tatami",
		change_id: "xyz789",
		files: [
			{ path: "src/main.rs", status: "modified" },
			{ path: "README.md", status: "added" },
		],
	}),
	get_file_diff: (): FileDiff => ({
		path: "src/main.rs",
		hunks: [
			{
				old_start: 1,
				old_count: 3,
				new_start: 1,
				new_count: 4,
				lines: [
					{ line_type: "context", content: "fn main() {", old_line_number: 1, new_line_number: 1 },
					{ line_type: "remove", content: '    println!("old");', old_line_number: 2, new_line_number: null },
					{ line_type: "add", content: '    println!("new");', old_line_number: null, new_line_number: 2 },
					{ line_type: "add", content: '    println!("extra");', old_line_number: null, new_line_number: 3 },
					{ line_type: "context", content: "}", old_line_number: 3, new_line_number: 4 },
				],
			},
		],
	}),
	watch_repository: () => undefined,
	unwatch_repository: () => undefined,
};

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	const handler = handlers[cmd];
	if (!handler) {
		console.warn(`[Mock] No handler for command: ${cmd}`);
		throw new Error(`[Mock] No handler for command: ${cmd}`);
	}
	// Simulate network delay
	await new Promise((r) => setTimeout(r, 50));
	console.log(`[Mock] ${cmd}`, args ?? "");
	return handler(args) as T;
}
