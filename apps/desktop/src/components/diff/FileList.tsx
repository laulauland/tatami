import {
	ChevronDownIcon,
	ChevronRightIcon,
	FileIcon,
	FileMinus2Icon,
	FilePenIcon,
	FilePlus2Icon,
	FolderIcon,
	FolderOpenIcon,
	FolderTreeIcon,
	ListIcon,
	SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { cn } from "@/lib/utils";
import type { ChangedFile, ChangedFileStatus } from "@/schemas";

interface FileListProps {
	files: ChangedFile[];
	selectedFiles: Set<string>;
	onSelectFiles: (filePaths: Set<string>) => void;
	totalAdditions: number;
	totalDeletions: number;
	hasFocus: boolean;
}

function getFileStatusIcon(status: ChangedFileStatus) {
	switch (status) {
		case "added":
			return <FilePlus2Icon className="size-4 text-green-500 shrink-0" />;
		case "deleted":
			return <FileMinus2Icon className="size-4 text-red-500 shrink-0" />;
		case "modified":
			return <FilePenIcon className="size-4 text-yellow-500 shrink-0" />;
		default:
			return <FileIcon className="size-4 text-muted-foreground shrink-0" />;
	}
}

function getFileName(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

function getFileDirectory(filePath: string): string {
	const parts = filePath.split("/");
	if (parts.length <= 1) return "";
	parts.pop();
	return parts.join("/");
}

// Tree node structure
interface TreeNode {
	name: string;
	path: string;
	isDirectory: boolean;
	children: Map<string, TreeNode>;
	file?: ChangedFile;
}

function buildTree(files: ChangedFile[]): TreeNode {
	const root: TreeNode = {
		name: "",
		path: "",
		isDirectory: true,
		children: new Map(),
	};

	for (const file of files) {
		const parts = file.path.split("/");
		let current = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;
			const pathSoFar = parts.slice(0, i + 1).join("/");

			if (!current.children.has(part)) {
				current.children.set(part, {
					name: part,
					path: pathSoFar,
					isDirectory: !isLast,
					children: new Map(),
					file: isLast ? file : undefined,
				});
			}

			const nextNode = current.children.get(part);
			if (nextNode) {
				current = nextNode;
			}
		}
	}

	return root;
}

// Flatten single-child directories (e.g., "apps/desktop/src" becomes one node)
function collapseSingleChildDirs(node: TreeNode): TreeNode {
	// Process children first
	const processedChildren = new Map<string, TreeNode>();

	for (const [key, child] of node.children) {
		const processed = collapseSingleChildDirs(child);
		processedChildren.set(key, processed);
	}

	node.children = processedChildren;

	// If this directory has exactly one child that is also a directory, merge them
	if (node.isDirectory && node.children.size === 1) {
		const [, onlyChild] = [...node.children.entries()][0];
		if (onlyChild.isDirectory) {
			const mergedName = node.name ? `${node.name}/${onlyChild.name}` : onlyChild.name;
			return {
				...onlyChild,
				name: mergedName,
			};
		}
	}

	return node;
}

// Sort tree nodes: directories first, then alphabetically
function getSortedChildren(node: TreeNode): TreeNode[] {
	const children = Array.from(node.children.values());
	return children.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) {
			return a.isDirectory ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
}

interface TreeNodeComponentProps {
	node: TreeNode;
	depth: number;
	selectedFiles: Set<string>;
	onSelectFile: (filePath: string, modifiers: { shift: boolean; meta: boolean }) => void;
	onSelectFolder: (folderPath: string) => void;
	expandedDirs: Set<string>;
	toggleDir: (path: string) => void;
	itemRefs: React.RefObject<Map<string, HTMLButtonElement>>;
}

// Collect all file paths under a tree node
function collectFilePaths(node: TreeNode): string[] {
	if (!node.isDirectory) {
		return node.path ? [node.path] : [];
	}
	const paths: string[] = [];
	for (const child of node.children.values()) {
		paths.push(...collectFilePaths(child));
	}
	return paths;
}

function TreeNodeComponent({
	node,
	depth,
	selectedFiles,
	onSelectFile,
	onSelectFolder,
	expandedDirs,
	toggleDir,
	itemRefs,
}: TreeNodeComponentProps) {
	const isExpanded = expandedDirs.has(node.path);
	const sortedChildren = getSortedChildren(node);

	if (node.isDirectory) {
		return (
			<div>
				<button
					type="button"
					onClick={(e) => {
						if (e.metaKey || e.ctrlKey) {
							// Cmd/Ctrl+click selects all files in folder
							onSelectFolder(node.path);
						} else {
							toggleDir(node.path);
						}
					}}
					className="w-full flex items-center gap-1.5 px-3 py-1 text-left text-sm text-muted-foreground"
					style={{ paddingLeft: `${depth * 12 + 12}px` }}
				>
					{isExpanded ? (
						<ChevronDownIcon className="size-3 shrink-0" />
					) : (
						<ChevronRightIcon className="size-3 shrink-0" />
					)}
					{isExpanded ? (
						<FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
					) : (
						<FolderIcon className="size-4 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate">{node.name}</span>
				</button>
				{isExpanded && (
					<div>
						{sortedChildren.map((child) => (
							<TreeNodeComponent
								key={child.path}
								node={child}
								depth={depth + 1}
								selectedFiles={selectedFiles}
								onSelectFile={onSelectFile}
								onSelectFolder={onSelectFolder}
								expandedDirs={expandedDirs}
								toggleDir={toggleDir}
								itemRefs={itemRefs}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	// File node
	const isSelected = selectedFiles.has(node.path);
	// Add extra padding to align with folder text (chevron width + gap)
	const fileIndent = depth * 12 + 12 + 18;
	return (
		<button
			key={node.path}
			ref={(el) => {
				if (el) itemRefs.current?.set(node.path, el);
				else itemRefs.current?.delete(node.path);
			}}
			type="button"
			onClick={(e) => onSelectFile(node.path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })}
			className={cn(
				"w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm",
				isSelected ? "bg-accent/40 text-foreground" : "text-muted-foreground",
			)}
			style={{ paddingLeft: `${fileIndent}px` }}
		>
			{node.file && getFileStatusIcon(node.file.status)}
			<span className="truncate font-medium">{node.name}</span>
		</button>
	);
}

export function FileList({
	files,
	selectedFiles,
	onSelectFiles,
	totalAdditions,
	totalDeletions,
	hasFocus,
}: FileListProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
	const [filterQuery, setFilterQuery] = useState("");
	const [viewMode, setViewMode] = useState<"flat" | "tree">("tree");
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null);

	// Filter files by search query
	const filteredFiles = useMemo(() => {
		if (!filterQuery.trim()) return files;
		const query = filterQuery.toLowerCase();
		return files.filter((f) => f.path.toLowerCase().includes(query));
	}, [files, filterQuery]);

	// Build tree from filtered files
	const tree = useMemo(() => {
		const rawTree = buildTree(filteredFiles);
		return collapseSingleChildDirs(rawTree);
	}, [filteredFiles]);

	// Auto-expand all directories when switching to tree view or when filter changes
	useEffect(() => {
		if (viewMode === "tree") {
			const allDirs = new Set<string>();
			const collectDirs = (node: TreeNode) => {
				if (node.isDirectory && node.path) {
					allDirs.add(node.path);
				}
				for (const child of node.children.values()) {
					collectDirs(child);
				}
			};
			collectDirs(tree);
			setExpandedDirs(allDirs);
		}
	}, [viewMode, tree]);

	const toggleDir = useCallback((path: string) => {
		setExpandedDirs((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}, []);

	// Handle file selection with modifiers
	const handleSelectFile = useCallback(
		(filePath: string, modifiers: { shift: boolean; meta: boolean }) => {
			const clickedIndex = filteredFiles.findIndex((f) => f.path === filePath);

			if (modifiers.meta) {
				// Cmd/Ctrl+click: toggle selection
				const newSelected = new Set(selectedFiles);
				if (newSelected.has(filePath)) {
					newSelected.delete(filePath);
				} else {
					newSelected.add(filePath);
				}
				onSelectFiles(newSelected);
				setLastClickedIndex(clickedIndex);
			} else if (modifiers.shift && lastClickedIndex !== null) {
				// Shift+click: range selection
				const start = Math.min(lastClickedIndex, clickedIndex);
				const end = Math.max(lastClickedIndex, clickedIndex);
				const newSelected = new Set(selectedFiles);
				for (let i = start; i <= end; i++) {
					newSelected.add(filteredFiles[i].path);
				}
				onSelectFiles(newSelected);
			} else {
				// Normal click: single selection
				onSelectFiles(new Set([filePath]));
				setLastClickedIndex(clickedIndex);
			}
		},
		[filteredFiles, selectedFiles, onSelectFiles, lastClickedIndex],
	);

	// Handle folder selection (select all files in folder)
	const handleSelectFolder = useCallback(
		(folderPath: string) => {
			// Find the tree node for this folder
			const findNode = (node: TreeNode, path: string): TreeNode | null => {
				if (node.path === path) return node;
				for (const child of node.children.values()) {
					const found = findNode(child, path);
					if (found) return found;
				}
				return null;
			};

			const folderNode = findNode(tree, folderPath);
			if (!folderNode) return;

			const folderFiles = collectFilePaths(folderNode);
			const allSelected = folderFiles.every((f) => selectedFiles.has(f));

			const newSelected = new Set(selectedFiles);
			if (allSelected) {
				// Deselect all files in folder
				for (const f of folderFiles) {
					newSelected.delete(f);
				}
			} else {
				// Select all files in folder
				for (const f of folderFiles) {
					newSelected.add(f);
				}
			}
			onSelectFiles(newSelected);
		},
		[tree, selectedFiles, onSelectFiles],
	);

	// Get first selected file index for navigation
	const firstSelectedPath = selectedFiles.size > 0 ? [...selectedFiles][0] : null;
	const selectedIndex = firstSelectedPath
		? filteredFiles.findIndex((f) => f.path === firstSelectedPath)
		: -1;

	// Navigate to next file
	const navigateDown = useCallback(() => {
		if (filteredFiles.length === 0) return;
		const nextIndex = selectedIndex < filteredFiles.length - 1 ? selectedIndex + 1 : selectedIndex;
		const nextFile = filteredFiles[nextIndex];
		if (nextFile) {
			onSelectFiles(new Set([nextFile.path]));
			setLastClickedIndex(nextIndex);
		}
	}, [filteredFiles, selectedIndex, onSelectFiles]);

	// Navigate to previous file
	const navigateUp = useCallback(() => {
		if (filteredFiles.length === 0) return;
		const prevIndex = selectedIndex > 0 ? selectedIndex - 1 : 0;
		const prevFile = filteredFiles[prevIndex];
		if (prevFile) {
			onSelectFiles(new Set([prevFile.path]));
			setLastClickedIndex(prevIndex);
		}
	}, [filteredFiles, selectedIndex, onSelectFiles]);

	// Keyboard navigation when diff panel is focused
	useKeyboardShortcut({
		key: "j",
		onPress: navigateDown,
		enabled: hasFocus,
	});

	useKeyboardShortcut({
		key: "k",
		onPress: navigateUp,
		enabled: hasFocus,
	});

	useKeyboardShortcut({
		key: "ArrowDown",
		onPress: navigateDown,
		enabled: hasFocus,
	});

	useKeyboardShortcut({
		key: "ArrowUp",
		onPress: navigateUp,
		enabled: hasFocus,
	});

	// Scroll first selected item into view
	useEffect(() => {
		if (firstSelectedPath) {
			const item = itemRefs.current.get(firstSelectedPath);
			item?.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}, [firstSelectedPath]);

	return (
		<div className="flex flex-col h-full w-full overflow-hidden">
			{/* Summary header */}
			<div className="border-b border-border px-3 py-2 text-xs text-muted-foreground shrink-0">
				<div className="flex items-center justify-between">
					<span>
						{files.length} {files.length === 1 ? "file" : "files"} changed
					</span>
					<div className="flex items-center gap-2">
						<span>
							<span className="text-green-500">+{totalAdditions}</span>
							{" / "}
							<span className="text-red-500">-{totalDeletions}</span>
						</span>
						<Button
							variant="ghost"
							size="icon"
							className="size-6"
							onClick={() => setViewMode(viewMode === "flat" ? "tree" : "flat")}
							title={viewMode === "flat" ? "Switch to tree view" : "Switch to flat list"}
						>
							{viewMode === "flat" ? (
								<FolderTreeIcon className="size-3.5" />
							) : (
								<ListIcon className="size-3.5" />
							)}
						</Button>
					</div>
				</div>
			</div>

			{/* Search filter */}
			<div className="px-2 py-2 border-b border-border shrink-0">
				<div className="relative">
					<SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
					<Input
						type="text"
						placeholder="Filter files..."
						value={filterQuery}
						onChange={(e) => setFilterQuery(e.target.value)}
						className="h-7 pl-7 text-xs rounded-md"
					/>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div ref={listRef}>
					{viewMode === "flat"
						? // Flat list view
							filteredFiles.map((file, index) => {
								const isSelected = selectedFiles.has(file.path);
								const fileName = getFileName(file.path);
								const directory = getFileDirectory(file.path);

								return (
									<button
										key={file.path}
										ref={(el) => {
											if (el) itemRefs.current.set(file.path, el);
											else itemRefs.current.delete(file.path);
										}}
										type="button"
										onClick={(e) =>
											handleSelectFile(file.path, {
												shift: e.shiftKey,
												meta: e.metaKey || e.ctrlKey,
											})
										}
										className={cn(
											"w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm",
											isSelected
												? "bg-accent/40 text-foreground"
												: index % 2 === 1
													? "bg-muted/30 text-muted-foreground"
													: "text-muted-foreground",
										)}
									>
										{getFileStatusIcon(file.status)}
										<span className="flex-1 min-w-0 truncate">
											<span className="font-medium">{fileName}</span>
											{directory && (
												<span className="text-muted-foreground ml-1 text-xs">{directory}</span>
											)}
										</span>
									</button>
								);
							})
						: // Tree view
							getSortedChildren(tree).map((child) => (
								<TreeNodeComponent
									key={child.path}
									node={child}
									depth={0}
									selectedFiles={selectedFiles}
									onSelectFile={handleSelectFile}
									onSelectFolder={handleSelectFolder}
									expandedDirs={expandedDirs}
									toggleDir={toggleDir}
									itemRefs={itemRefs}
								/>
							))}
				</div>
			</ScrollArea>
		</div>
	);
}
