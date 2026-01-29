const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"svg",
	"webp",
	"ico",
	"bmp",
	"tiff",
	"avif",
]);

const MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	ico: "image/x-icon",
	bmp: "image/bmp",
	tiff: "image/tiff",
	avif: "image/avif",
};

export function isImageFile(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTENSIONS.has(ext);
}

export function getMimeType(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[ext] ?? "application/octet-stream";
}
