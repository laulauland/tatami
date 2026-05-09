import { Database } from "bun:sqlite";
import { Utils } from "electrobun/bun";
import { Context, Data, Effect, Layer } from "effect";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { AppLayout, Project, UpsertProjectParams } from "../../shared/rpc.ts";

export class StorageServiceError extends Data.TaggedError("StorageServiceError")<{
	readonly operation: "init" | "getProjects" | "upsertProject" | "removeProject" | "getLayout" | "updateLayout";
	readonly cause: unknown;
}> {}

type ProjectRow = {
	id: string;
	path: string;
	name: string;
	last_opened_at: string;
	revset_preset: string | null;
};

type LayoutKey = keyof AppLayout;

const layoutKeys = ["active_project_id", "selected_change_id", "sidebar_width"] as const satisfies readonly LayoutKey[];

function resolveDataDir(): string {
	try {
		return Utils.paths.userData;
	} catch {
		if (process.platform === "darwin") {
			return join(homedir(), "Library", "Application Support", "tatami");
		}
		return join(homedir(), ".local", "share", "tatami");
	}
}

function initDatabase(): Database {
	const dataDir = resolveDataDir();
	mkdirSync(dataDir, { recursive: true });
	const db = new Database(join(dataDir, "tatami.sqlite"));
	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			last_opened_at TEXT NOT NULL DEFAULT (datetime('now')),
			revset_preset TEXT
		);
		CREATE TABLE IF NOT EXISTS layout (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
	`);
	return db;
}

function toProject(row: ProjectRow): Project {
	return {
		id: row.id,
		path: row.path,
		name: row.name,
		last_opened_at: row.last_opened_at,
		revset_preset: row.revset_preset,
	};
}

function defaultProjectName(path: string): string {
	return basename(resolve(path)) || path;
}

function emptyLayout(): AppLayout {
	return {
		active_project_id: null,
		selected_change_id: null,
		sidebar_width: null,
	};
}

export class StorageService extends Context.Tag("tatami/StorageService")<
	StorageService,
	{
		readonly getProjects: () => Effect.Effect<Project[], StorageServiceError>;
		readonly upsertProject: (
			params: UpsertProjectParams,
		) => Effect.Effect<Project, StorageServiceError>;
		readonly removeProject: (id: string) => Effect.Effect<void, StorageServiceError>;
		readonly getLayout: () => Effect.Effect<AppLayout, StorageServiceError>;
		readonly updateLayout: (layout: Partial<AppLayout>) => Effect.Effect<void, StorageServiceError>;
	}
>() {
	static readonly Live = Layer.effect(
		StorageService,
		Effect.try({
			try: initDatabase,
			catch: (cause) => new StorageServiceError({ operation: "init", cause }),
		}).pipe(
			Effect.map((db) => {
				const getLayoutValue = db.query<{ value: string }, [string]>(
					"SELECT value FROM layout WHERE key = ?",
				);
				const upsertLayoutValue = db.query<unknown, [string, string]>(
					"INSERT INTO layout (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				);
				const deleteLayoutValue = db.query<unknown, [string]>("DELETE FROM layout WHERE key = ?");

				return StorageService.of({
					getProjects: () =>
						Effect.try({
							try: () =>
								db
									.query<ProjectRow, []>(
										"SELECT id, path, name, last_opened_at, revset_preset FROM projects ORDER BY last_opened_at DESC, name ASC",
									)
									.all()
									.map(toProject),
							catch: (cause) => new StorageServiceError({ operation: "getProjects", cause }),
						}),

					upsertProject: ({ path, name, revset_preset = null }) =>
						Effect.try({
							try: () => {
								const resolvedPath = resolve(path);
								const projectName = name?.trim() || defaultProjectName(resolvedPath);
								const existing = db
									.query<ProjectRow, [string]>(
										"SELECT id, path, name, last_opened_at, revset_preset FROM projects WHERE path = ?",
									)
									.get(resolvedPath);
								const id = existing?.id ?? crypto.randomUUID();

								db.query<unknown, [string, string, string, string | null]>(
									`INSERT INTO projects (id, path, name, last_opened_at, revset_preset)
									 VALUES (?, ?, ?, datetime('now'), ?)
									 ON CONFLICT(path) DO UPDATE SET
										name = excluded.name,
										last_opened_at = excluded.last_opened_at,
										revset_preset = excluded.revset_preset`,
								).run(id, resolvedPath, projectName, revset_preset);

								const project = db
									.query<ProjectRow, [string]>(
										"SELECT id, path, name, last_opened_at, revset_preset FROM projects WHERE id = ?",
									)
									.get(id);
								if (!project) {
									throw new Error(`Failed to load project after upsert: ${id}`);
								}
								return toProject(project);
							},
							catch: (cause) => new StorageServiceError({ operation: "upsertProject", cause }),
						}),

					removeProject: (id) =>
						Effect.try({
							try: () => {
								db.query<unknown, [string]>("DELETE FROM projects WHERE id = ?").run(id);
								const active = getLayoutValue.get("active_project_id")?.value ?? null;
								if (active === id) {
									deleteLayoutValue.run("active_project_id");
								}
							},
							catch: (cause) => new StorageServiceError({ operation: "removeProject", cause }),
						}),

					getLayout: () =>
						Effect.try({
							try: () => {
								const layout = emptyLayout();
								for (const key of layoutKeys) {
									const value = getLayoutValue.get(key)?.value ?? null;
									if (key === "sidebar_width") {
										layout.sidebar_width = value == null ? null : Number(value);
									} else {
										layout[key] = value;
									}
								}
								return layout;
							},
							catch: (cause) => new StorageServiceError({ operation: "getLayout", cause }),
						}),

					updateLayout: (layout) =>
						Effect.try({
							try: () => {
								for (const key of layoutKeys) {
									const value = layout[key];
									if (value === undefined) continue;
									if (value === null) {
										deleteLayoutValue.run(key);
									} else {
										upsertLayoutValue.run(key, String(value));
									}
								}
							},
							catch: (cause) => new StorageServiceError({ operation: "updateLayout", cause }),
						}),
				});
			}),
		),
	);
}
