import { useAtom } from "@effect-atom/atom-react";
import { shortcutsHelpOpenAtom } from "@/atoms";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useKeyboardShortcut } from "@/hooks/useKeyboard";

const shortcuts = [
	{ category: "Navigation", items: [
		{ keys: ["j", "↓"], description: "Move down" },
		{ keys: ["k", "↑"], description: "Move up" },
		{ keys: ["J"], description: "Jump to parent revision" },
		{ keys: ["K"], description: "Jump to child revision" },
		{ keys: ["@"], description: "Jump to working copy" },
		{ keys: ["g g"], description: "Jump to first revision" },
		{ keys: ["G"], description: "Jump to last revision" },
		{ keys: ["Esc"], description: "Deselect" },
	]},
	{ category: "General", items: [
		{ keys: ["⌘", "O"], description: "Open command palette" },
		{ keys: ["⌘", ","], description: "Open settings" },
		{ keys: ["?"], description: "Show this help" },
	]},
];

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-sm bg-muted text-muted-foreground text-[10px] font-mono border border-border">
			{children}
		</kbd>
	);
}

export function KeyboardShortcutsHelp() {
	const [open, setOpen] = useAtom(shortcutsHelpOpenAtom);

	useKeyboardShortcut({
		key: "?",
		onPress: () => setOpen((prev) => !prev),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Keyboard Shortcuts</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					{shortcuts.map((section) => (
						<div key={section.category}>
							<h3 className="text-xs font-medium text-muted-foreground mb-2">
								{section.category}
							</h3>
							<div className="space-y-1.5">
								{section.items.map((shortcut) => (
									<div
										key={shortcut.description}
										className="flex items-center justify-between"
									>
										<span className="text-xs">{shortcut.description}</span>
										<div className="flex items-center gap-1">
											{shortcut.keys.map((key, i) => (
												<Kbd key={i}>{key}</Kbd>
											))}
										</div>
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
