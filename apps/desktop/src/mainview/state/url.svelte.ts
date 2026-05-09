function readSelectedRevisionId(): string | null {
	if (typeof window === "undefined") return null;
	return new URL(window.location.href).searchParams.get("rev");
}

function writeSelectedRevisionId(revisionId: string | null): void {
	if (typeof window === "undefined") return;
	const url = new URL(window.location.href);
	if (revisionId == null || revisionId.length === 0) {
		url.searchParams.delete("rev");
	} else {
		url.searchParams.set("rev", revisionId);
	}
	window.history.replaceState(window.history.state, "", url);
}

let selectedRevisionId = $state<string | null>(readSelectedRevisionId());

export function getSelectedRevisionId(): string | null {
	return selectedRevisionId;
}

export function setSelectedRevisionId(revisionId: string | null): void {
	selectedRevisionId = revisionId;
	writeSelectedRevisionId(revisionId);
}

export function syncSelectedRevisionFromLocation(): void {
	selectedRevisionId = readSelectedRevisionId();
}
