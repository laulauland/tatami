export type BookmarkInfo = {
	name: string;
	is_tracked: boolean;
	remote: string | null;
	is_ahead: boolean;
	is_behind: boolean;
	is_conflicted: boolean;
};

export type ParentEdge = {
	parent_id: string;
	edge_type: "direct" | "indirect" | "missing";
};

export type RevisionStub = {
	commit_id: string;
	change_id: string;
	change_id_short: string;
	parent_edges: ParentEdge[];
	children_ids: string[];
	description: string;
	author: string;
	timestamp: string;
	is_working_copy: boolean;
	is_immutable: boolean;
	is_mine: boolean;
	is_trunk: boolean;
	is_divergent: boolean;
	divergent_index: number | null;
	has_conflict: boolean;
	bookmarks: BookmarkInfo[];
};

export type GetRevisionsParams = {
	repoPath?: string;
	limit?: number;
};

export type Project = {
	id: string;
	path: string;
	name: string;
	last_opened_at: string;
	revset_preset: string | null;
};

export type UpsertProjectParams = {
	path: string;
	name?: string;
	revset_preset?: string | null;
};

export type AppLayout = {
	active_project_id: string | null;
	selected_change_id: string | null;
	sidebar_width: number | null;
};

export type AppRPC = {
	bun: {
		requests: {
			getRevisions: {
				params: GetRevisionsParams;
				response: RevisionStub[];
			};
			getProjects: {
				params: {};
				response: Project[];
			};
			upsertProject: {
				params: UpsertProjectParams;
				response: Project;
			};
			removeProject: {
				params: { id: string };
				response: void;
			};
			getLayout: {
				params: {};
				response: AppLayout;
			};
			updateLayout: {
				params: Partial<AppLayout>;
				response: void;
			};
			openRepositoryDialog: {
				params: {};
				response: string | null;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {
			repoChanged: { timestamp: number };
		};
	};
};
