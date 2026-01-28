import { useAtom } from "@effect-atom/atom-react";
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
import { focusPanelAtom } from "@/atoms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";
import { cn } from "@/lib/utils";
import type { ChangedFile, ChangedFileStatus } from "@/schemas";

interface FileListProps {
	files: ChangedFile[];
	selectedFile: string | null;
	onSelectFile: (filePath: string) => void;
	totalAdditions: number;
	totalDeletions: number;
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
	selectedFile: string | null;
	onSelectFile: (filePath: string) => void;
	expandedDirs: Set<string>;
	toggleDir: (path: string) => void;
	itemRefs: React.RefObject<Map<string, HTMLButtonElement>>;
}

function TreeNodeComponent({
	node,
	depth,
	selectedFile,
	onSelectFile,
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
					onClick={() => toggleDir(node.path)}
					className={cn(
						"w-full flex items-center gap-1.5 px-3 py-1 text-left text-sm transition-colors",
						"hover:bg-accent/50 text-muted-foreground",
					)}
					style={{ paddingLeft: `${depth * 12 + 12}px` }}
				>
					{isExpanded ? (
						<ChevronDownIcon className="size-3 shrink-0" />
					) : (
						<ChevronRightIcon className="size-3 shrink-0" />
					)}
					{isExpanded ? (
						<FolderOpenIcon className="size-4 shrink-0 text-amber-500" />
					) : (
						<FolderIcon className="size-4 shrink-0 text-amber-500" />
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
								selectedFile={selectedFile}
								onSelectFile={onSelectFile}
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
	const isSelected = node.path === selectedFile;
	return (
		<button
			key={node.path}
			ref={(el) => {
				if (el) itemRefs.current?.set(node.path, el);
				else itemRefs.current?.delete(node.path);
			}}
			type="button"
			onClick={() => onSelectFile(node.path)}
			className={cn(
				"w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
				"hover:bg-accent/50",
				isSelected && "bg-primary/10 text-foreground",
			)}
			style={{ paddingLeft: `${depth * 12 + 12}px` }}
		>
			{node.file && getFileStatusIcon(node.file.status)}
			<span className="truncate font-medium">{node.name}</span>
		</button>
	);
}

export function FileList({
	files,
	selectedFile,
	onSelectFile,
	totalAdditions,
	totalDeletions,
}: FileListProps) {
	const [focusPanel] = useAtom(focusPanelAtom);
	const hasFocus = focusPanel === "diff";
	const listRef = useRef<HTMLDivElement>(null);
	const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
	const [filterQuery, setFilterQuery] = useState("");
	const [viewMode, setViewMode] = useState<"flat" | "tree">("tree");
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

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

	const selectedIndex = selectedFile ? filteredFiles.findIndex((f) => f.path === selectedFile) : -1;

	// Navigate to next file
	const navigateDown = useCallback(() => {
		if (filteredFiles.length === 0) return;
		const nextIndex = selectedIndex < filteredFiles.length - 1 ? selectedIndex + 1 : selectedIndex;
		const nextFile = filteredFiles[nextIndex];
		if (nextFile) onSelectFile(nextFile.path);
	}, [filteredFiles, selectedIndex, onSelectFile]);

	// Navigate to previous file
	const navigateUp = useCallback(() => {
		if (filteredFiles.length === 0) return;
		const prevIndex = selectedIndex > 0 ? selectedIndex - 1 : 0;
		const prevFile = filteredFiles[prevIndex];
		if (prevFile) onSelectFile(prevFile.path);
	}, [filteredFiles, selectedIndex, onSelectFile]);

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

	// Scroll selected item into view
	useEffect(() => {
		if (selectedFile) {
			const item = itemRefs.current.get(selectedFile);
			item?.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}, [selectedFile]);

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
						className="h-7 pl-7 text-xs"
					/>
				</div>
			</div>

			<ScrollArea className="flex-1">
				<div ref={listRef} className="py-1">
					{viewMode === "flat"
						? // Flat list view
							filteredFiles.map((file) => {
								const isSelected = file.path === selectedFile;
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
										onClick={() => onSelectFile(file.path)}
										className={cn(
											"w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
											"hover:bg-accent/50",
											isSelected && "bg-primary/10 text-foreground",
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
									selectedFile={selectedFile}
									onSelectFile={onSelectFile}
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
