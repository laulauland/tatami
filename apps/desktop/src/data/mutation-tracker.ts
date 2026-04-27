export const inFlightMutations = new Set<string>();

export function trackMutation<T>(mutationId: string, promise: Promise<T>): Promise<T> {
	inFlightMutations.add(mutationId);
	return promise.finally(() => {
		inFlightMutations.delete(mutationId);
	});
}
