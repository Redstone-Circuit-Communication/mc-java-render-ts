/** A task boundary (not a resolved Promise) so input and paint can run. */
export function yieldToMain(): Promise<void> {
	const scheduler = (
		globalThis as typeof globalThis & {
			scheduler?: { yield?: () => Promise<void> };
		}
	).scheduler;
	return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** Share one checkpoint across concurrent lanes to keep cached microtasks
 * from starving the browser. No task hop for cheap work below the budget. */
export function createWorkCheckpoint(budgetMs = 6): () => Promise<void> | undefined {
	let started = performance.now();
	let pending: Promise<void> | undefined;
	return () => {
		if (pending) return pending;
		if (performance.now() - started < budgetMs) return;
		pending = yieldToMain().then(() => {
			started = performance.now();
			pending = undefined;
		});
		return pending;
	};
}
