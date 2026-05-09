export type RevisionStub = {
	changeId: string;
	commitId: string;
	description: string;
	author: string;
	timestamp: string;
	bookmarks: string[];
	isWorkingCopy: boolean;
};

export type AppRPC = {
	bun: {
		requests: {
			getRevisions: {
				params: Record<string, never>;
				response: RevisionStub[];
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
