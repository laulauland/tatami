import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import type { Project } from "../../../src-electrobun/shared/rpc.ts";

export const repositoriesCollection = createCollection(
	localOnlyCollectionOptions<Project, string>({
		id: "repositories",
		getKey: (project) => project.id,
	}),
);

export async function populateRepositories(projects: Project[]): Promise<void> {
	const existingKeys = [...repositoriesCollection.keys()];

	if (existingKeys.length > 0) {
		await repositoriesCollection.delete(existingKeys).isPersisted.promise;
	}

	if (projects.length > 0) {
		await repositoriesCollection.insert(projects).isPersisted.promise;
	}
}
