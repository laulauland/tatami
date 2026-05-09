import { existsSync, watch, type FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { Context, Data, Effect, Layer } from "effect";

const WATCH_DEBOUNCE_MS = 500;

type WatcherEntry = {
	watcher: FSWatcher;
	timer: ReturnType<typeof setTimeout> | null;
};

type RepoChangedHandler = (event: { repoPath: string; timestamp: number }) => void;

export class WatcherServiceError extends Data.TaggedError("WatcherServiceError")<{
	readonly operation: "watch" | "unwatch" | "unwatchAll";
	readonly repoPath?: string;
	readonly cause: unknown;
}> {}

export class WatcherService extends Context.Tag("tatami/WatcherService")<
	WatcherService,
	{
		readonly watch: (repoPath: string) => Effect.Effect<void, WatcherServiceError>;
		readonly unwatch: (repoPath: string) => Effect.Effect<void, WatcherServiceError>;
		readonly unwatchAll: () => Effect.Effect<void, WatcherServiceError>;
		readonly setRepoChangedHandler: (handler: RepoChangedHandler) => Effect.Effect<void>;
	}
>() {
	static readonly Live = Layer.succeed(
		WatcherService,
		WatcherService.of((() => {
			const watchers = new Map<string, WatcherEntry>();
			let repoChangedHandler: RepoChangedHandler | null = null;

			function normalizeRepoPath(repoPath: string): string {
				return resolve(repoPath);
			}

			function closeEntry(entry: WatcherEntry): void {
				if (entry.timer != null) {
					clearTimeout(entry.timer);
				}
				entry.watcher.close();
			}

			return {
				setRepoChangedHandler: (handler) =>
					Effect.sync(() => {
						repoChangedHandler = handler;
					}),
				watch: (repoPath) =>
					Effect.try({
						try: () => {
							const normalizedRepoPath = normalizeRepoPath(repoPath);
							if (watchers.has(normalizedRepoPath)) return;

							const jjRepoPath = join(normalizedRepoPath, ".jj", "repo");
							if (!existsSync(jjRepoPath)) {
								throw new Error(`jj repo metadata directory does not exist: ${jjRepoPath}`);
							}

							const entry: WatcherEntry = {
								watcher: watch(jjRepoPath, { recursive: true }, () => {
									const currentEntry = watchers.get(normalizedRepoPath);
									if (currentEntry == null) return;

									if (currentEntry.timer != null) {
										clearTimeout(currentEntry.timer);
									}

									currentEntry.timer = setTimeout(() => {
										currentEntry.timer = null;
										repoChangedHandler?.({
											repoPath: normalizedRepoPath,
											timestamp: Date.now(),
										});
									}, WATCH_DEBOUNCE_MS);
								}),
								timer: null,
							};

							entry.watcher.on("error", (cause) => {
								console.error(`Repository watcher failed for ${normalizedRepoPath}`, cause);
								const currentEntry = watchers.get(normalizedRepoPath);
								if (currentEntry != null) {
									watchers.delete(normalizedRepoPath);
									closeEntry(currentEntry);
								}
							});

							watchers.set(normalizedRepoPath, entry);
						},
						catch: (cause) => new WatcherServiceError({ operation: "watch", repoPath, cause }),
					}),
				unwatch: (repoPath) =>
					Effect.try({
						try: () => {
							const normalizedRepoPath = normalizeRepoPath(repoPath);
							const entry = watchers.get(normalizedRepoPath);
							if (entry == null) return;
							watchers.delete(normalizedRepoPath);
							closeEntry(entry);
						},
						catch: (cause) => new WatcherServiceError({ operation: "unwatch", repoPath, cause }),
					}),
				unwatchAll: () =>
					Effect.try({
						try: () => {
							for (const entry of watchers.values()) {
								closeEntry(entry);
							}
							watchers.clear();
						},
						catch: (cause) => new WatcherServiceError({ operation: "unwatchAll", cause }),
					}),
			};
		})()),
	);
}
