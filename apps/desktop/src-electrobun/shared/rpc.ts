type EmptyParams = Record<string, never>;

type EmptyMessages = Record<string, never>;

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

export type MutationResult = {
	operation_id: string;
	change_id: string | null;
};

export type Operation = {
	id: string;
	parent_ids: string[];
	description: string;
	timestamp: string;
	user: string;
	hostname: string;
	working_copy_change_id: string | null;
};

export type JjNewParams = {
	repoPath: string;
	parentChangeIds: string[];
	changeId?: string | null;
};

export type JjDescribeParams = {
	repoPath: string;
	changeId: string;
	description: string;
};

export type JjRebaseParams = {
	repoPath: string;
	sourceChangeId: string;
	destinationChangeId: string;
};

export type ChangedFileStatus = "modified" | "added" | "deleted";

export type ChangedFile = {
	path: string;
	status: ChangedFileStatus;
};

export type RevisionDiff = {
	change_id: string;
	diff: string;
};

export type RevisionChanges = {
	change_id: string;
	files: ChangedFile[];
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

export type RevsetResult = {
	change_ids: string[];
	error: string | null;
};

export type MessageBoxOptions = {
	type?: "info" | "warning" | "error" | "question";
	title?: string;
	message?: string;
	detail?: string;
	buttons?: string[];
	defaultId?: number;
	cancelId?: number;
};

export type MessageBoxResponse = {
	response: number;
};

export type AppRPC = {
	bun: {
		requests: {
			getRevisions: {
				params: GetRevisionsParams;
				response: RevisionStub[];
			};
			getRevisionChanges: {
				params: { repoPath: string; changeId: string };
				response: ChangedFile[];
			};
			getRevisionDiff: {
				params: { repoPath: string; changeId: string };
				response: string;
			};
			getChangesBatch: {
				params: { repoPath: string; changeIds: string[] };
				response: RevisionChanges[];
			};
			getDiffsBatch: {
				params: { repoPath: string; changeIds: string[] };
				response: RevisionDiff[];
			};
			generateChangeIds: {
				params: { repoPath: string; count: number };
				response: string[];
			};
			jjNew: {
				params: JjNewParams;
				response: MutationResult;
			};
			jjEdit: {
				params: { repoPath: string; changeId: string };
				response: MutationResult;
			};
			jjAbandon: {
				params: { repoPath: string; changeId: string };
				response: MutationResult;
			};
			jjDescribe: {
				params: JjDescribeParams;
				response: MutationResult;
			};
			jjSquash: {
				params: { repoPath: string; changeId: string };
				response: MutationResult;
			};
			jjRebase: {
				params: JjRebaseParams;
				response: MutationResult;
			};
			getOperations: {
				params: { repoPath: string; limit: number };
				response: Operation[];
			};
			resolveRevset: {
				params: { repoPath: string; revset: string };
				response: RevsetResult;
			};
			undoOperation: {
				params: { repoPath: string; operationId: string };
				response: MutationResult;
			};
			gitFetch: {
				params: { repoPath: string; remote?: string | null };
				response: MutationResult;
			};
			gitPush: {
				params: { repoPath: string; bookmarkNames: string[]; remote?: string | null };
				response: MutationResult;
			};
			getProjects: {
				params: EmptyParams;
				response: Project[];
			};
			upsertProject: {
				params: UpsertProjectParams;
				response: Project;
			};
			removeProject: {
				params: { id: string };
				response: undefined;
			};
			getLayout: {
				params: EmptyParams;
				response: AppLayout;
			};
			updateLayout: {
				params: Partial<AppLayout>;
				response: undefined;
			};
			openRepositoryDialog: {
				params: EmptyParams;
				response: string | null;
			};
			watchRepository: {
				params: { repoPath: string };
				response: undefined;
			};
			unwatchRepository: {
				params: { repoPath: string };
				response: undefined;
			};
			openExternal: {
				params: { url: string };
				response: boolean;
			};
			openPath: {
				params: { path: string };
				response: boolean;
			};
			showItemInFolder: {
				params: { path: string };
				response: undefined;
			};
			showMessageBox: {
				params: MessageBoxOptions;
				response: MessageBoxResponse;
			};
		};
		messages: EmptyMessages;
	};
	webview: {
		requests: EmptyParams;
		messages: {
			repoChanged: { repoPath: string; timestamp: number };
			openRepositoryRequested: EmptyParams;
			deepLink: { url: string };
		};
	};
};
