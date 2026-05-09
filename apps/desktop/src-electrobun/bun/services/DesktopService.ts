import { Utils } from "electrobun/bun";
import { Context, Data, Effect, Layer } from "effect";
import { findRepository } from "../utils/findRepository.ts";

export class DesktopServiceError extends Data.TaggedError("DesktopServiceError")<{
	readonly operation: "openFolderDialog";
	readonly cause: unknown;
}> {}

export class DesktopService extends Context.Tag("tatami/DesktopService")<
	DesktopService,
	{
		readonly openFolderDialog: () => Effect.Effect<string | null, DesktopServiceError>;
	}
>() {
	static readonly Live = Layer.succeed(
		DesktopService,
		DesktopService.of({
			openFolderDialog: () =>
				Effect.tryPromise({
					try: async () => {
						const chosenPaths = await Utils.openFileDialog({
							startingFolder: Utils.paths.home,
							canChooseFiles: false,
							canChooseDirectory: true,
							allowsMultipleSelection: false,
						});
						const selectedPath = chosenPaths.find((path) => path.length > 0) ?? null;
						return selectedPath == null ? null : findRepository(selectedPath);
					},
					catch: (cause) => new DesktopServiceError({ operation: "openFolderDialog", cause }),
				}),
		}),
	);
}
