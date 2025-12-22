import { createCollection } from "@tanstack/db";
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { listen } from "@tauri-apps/api/event";
import type { Project, Revision } from "@/tauri-commands";
import { getProjects, getRevisions, watchRepository } from "@/tauri-commands";

export const queryClient = new QueryClient();

export const projectsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["projects"],
		queryFn: getProjects,
		getKey: (project: Project) => project.id,
	}),
});

export const emptyRevisionsCollection = createCollection({
	...queryCollectionOptions({
		queryClient,
		queryKey: ["revisions", "empty"],
		queryFn: () => Promise.resolve([]),
		getKey: (revision: Revision) => revision.change_id,
	}),
});

const revisionCollections = new Map<string, ReturnType<typeof createRevisionsCollection>>();
const revisionWatchers = new Map<string, { unlisten: () => void; refCount: number }>();

function createRevisionsCollection(repoPath: string) {
	const collection = createCollection({
		...queryCollectionOptions({
			queryClient,
			queryKey: ["revisions", repoPath],
			queryFn: () => getRevisions(repoPath, 100),
			getKey: (revision: Revision) => revision.change_id,
		}),
	});

	// Set up file watcher with refcounting
	const setupWatcher = async () => {
		const existing = revisionWatchers.get(repoPath);
		if (existing) {
			existing.refCount++;
			return;
		}

		await watchRepository(repoPath);
		const unlisten = await listen<string>("repo-changed", async (event) => {
			if (event.payload === repoPath) {
				const revisions = await getRevisions(repoPath, 100);
				collection.utils.writeUpsert(revisions);
			}
		});

		revisionWatchers.set(repoPath, { unlisten, refCount: 1 });
	};

	setupWatcher();

	return collection;
}

export function getRevisionsCollection(repoPath: string) {
	let collection = revisionCollections.get(repoPath);
	if (!collection) {
		collection = createRevisionsCollection(repoPath);
		revisionCollections.set(repoPath, collection);
	}
	return collection;
}
