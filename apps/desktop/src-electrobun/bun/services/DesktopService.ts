import { ApplicationMenu, Utils } from "electrobun/bun";
import type { ApplicationMenuItemConfig } from "electrobun/bun";
import { Context, Data, Effect, Layer } from "effect";
import { findRepository } from "../utils/findRepository.ts";

export type MessageBoxOptions = {
	readonly type?: "info" | "warning" | "error" | "question";
	readonly title?: string;
	readonly message?: string;
	readonly detail?: string;
	readonly buttons?: string[];
	readonly defaultId?: number;
	readonly cancelId?: number;
};

export type MessageBoxResponse = {
	readonly response: number;
};

export class DesktopServiceError extends Data.TaggedError("DesktopServiceError")<{
	readonly operation:
		| "setupApplicationMenu"
		| "openFolderDialog"
		| "openExternal"
		| "openPath"
		| "showItemInFolder"
		| "showMessageBox";
	readonly cause: unknown;
}> {}

export class DesktopService extends Context.Tag("tatami/DesktopService")<
	DesktopService,
	{
		readonly setupApplicationMenu: () => Effect.Effect<void, DesktopServiceError>;
		readonly openFolderDialog: () => Effect.Effect<string | null, DesktopServiceError>;
		readonly openExternal: (url: string) => Effect.Effect<boolean, DesktopServiceError>;
		readonly openPath: (path: string) => Effect.Effect<boolean, DesktopServiceError>;
		readonly showItemInFolder: (path: string) => Effect.Effect<void, DesktopServiceError>;
		readonly showMessageBox: (
			options: MessageBoxOptions,
		) => Effect.Effect<MessageBoxResponse, DesktopServiceError>;
	}
>() {
	static readonly Live = Layer.succeed(
		DesktopService,
		DesktopService.of({
			setupApplicationMenu: () =>
				Effect.try({
					try: () => {
						const menu: ApplicationMenuItemConfig[] = [
							{
								label: "Tatami",
								submenu: [
									{ role: "hide" },
									{ role: "hideOthers" },
									{ role: "showAll" },
									{ type: "separator" },
									{ role: "quit" },
								],
							},
							{
								label: "File",
								submenu: [
									{ label: "Open Repository…", action: "open-repository" },
									{ type: "separator" },
									{ role: "quit" },
								],
							},
							{
								label: "Edit",
								submenu: [
									{ role: "undo" },
									{ role: "redo" },
									{ type: "separator" },
									{ role: "cut" },
									{ role: "copy" },
									{ role: "paste" },
									{ role: "selectAll" },
								],
							},
							{
								label: "Window",
								submenu: [
									{ role: "minimize" },
									{ role: "zoom" },
									{ role: "close" },
								],
							},
							{
								label: "Help",
								submenu: [{ role: "showHelp" }],
							},
						];
						ApplicationMenu.setApplicationMenu(menu);
					},
					catch: (cause) => new DesktopServiceError({ operation: "setupApplicationMenu", cause }),
				}),
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
			openExternal: (url) =>
				Effect.try({
					try: () => Utils.openExternal(url),
					catch: (cause) => new DesktopServiceError({ operation: "openExternal", cause }),
				}),
			openPath: (path) =>
				Effect.try({
					try: () => Utils.openPath(path),
					catch: (cause) => new DesktopServiceError({ operation: "openPath", cause }),
				}),
			showItemInFolder: (path) =>
				Effect.try({
					try: () => Utils.showItemInFolder(path),
					catch: (cause) => new DesktopServiceError({ operation: "showItemInFolder", cause }),
				}),
			showMessageBox: (options) =>
				Effect.tryPromise({
					try: () => Utils.showMessageBox(options),
					catch: (cause) => new DesktopServiceError({ operation: "showMessageBox", cause }),
				}),
		}),
	);
}
