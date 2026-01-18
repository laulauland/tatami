import { useAtom } from "@effect-atom/atom-react";
import {
	ChevronsDownUpIcon,
	ChevronsUpDownIcon,
	Columns2Icon,
	RowsIcon,
	SearchIcon,
} from "lucide-react";
import { diffStyleAtom } from "@/atoms";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

interface DiffToolbarProps {
	fileCount: number;
	allExpanded: boolean;
	onToggleAllFolds: () => void;
}

export function DiffToolbar({ fileCount, allExpanded, onToggleAllFolds }: DiffToolbarProps) {
	return (
		<div className="sticky top-0 z-10 bg-background border-b border-border">
			<div className="flex items-center gap-2 px-4 py-2">
				<span className="text-xs text-muted-foreground">
					{fileCount} {fileCount === 1 ? "file" : "files"}
				</span>

				{/* Search/file selector input */}
				<InputGroup className="bg-input/30 border-input/30 h-8 border-none shadow-none! *:data-[slot=input-group-addon]:pl-2! flex-1 rounded-md">
					<InputGroupInput
						placeholder="Search files..."
						className="w-full text-xs outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
					/>
					<InputGroupAddon>
						<SearchIcon className="size-4 shrink-0 opacity-50" />
					</InputGroupAddon>
				</InputGroup>

				<div className="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={onToggleAllFolds}
						title={allExpanded ? "Collapse all files" : "Expand all files"}
						className="h-6 w-6"
					>
						{allExpanded ? (
							<ChevronsDownUpIcon className="size-3.5" />
						) : (
							<ChevronsUpDownIcon className="size-3.5" />
						)}
					</Button>
					<DiffStyleToggle />
				</div>
			</div>
		</div>
	);
}

function DiffStyleToggle() {
	const [globalDiffStyle, setGlobalDiffStyle] = useAtom(diffStyleAtom);

	return (
		<>
			<Button
				variant={globalDiffStyle === "unified" ? "secondary" : "ghost"}
				size="icon-xs"
				onClick={() => setGlobalDiffStyle("unified")}
				title="Unified diff view"
				className="h-6 w-6"
			>
				<RowsIcon className="size-3" />
			</Button>
			<Button
				variant={globalDiffStyle === "split" ? "secondary" : "ghost"}
				size="icon-xs"
				onClick={() => setGlobalDiffStyle("split")}
				title="Split diff view"
				className="h-6 w-6"
			>
				<Columns2Icon className="size-3" />
			</Button>
		</>
	);
}
