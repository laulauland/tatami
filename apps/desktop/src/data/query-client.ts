import { QueryClient } from "@tanstack/query-core";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Number.POSITIVE_INFINITY, // Data fresh until watcher invalidates
			gcTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false, // Watcher handles this
			refetchOnMount: false, // Already have data from watcher
		},
	},
});
