type NucleationModule = typeof import("nucleation");

let runtime: NucleationModule | undefined;
let initialization: Promise<void> | undefined;

/**
 * nucleation's wasm loader picks Node or browser by `globalThis.process` alone. Hosts that define a `process` shim in the
 * browser (Nuxt's dev server, webpack polyfills) then send it down the Node path — `fs.readFileSync` is not a function and
 * the renderer never starts. A shim has no `versions.node`; hide it while the module evaluates, then put it back.
 */
async function importInBrowserMode(): Promise<NucleationModule> {
	const host = globalThis as { process?: { versions?: { node?: string } } };
	const shim = host.process && !host.process.versions?.node ? host.process : undefined;
	if (!shim) return import("nucleation");
	const own = Object.getOwnPropertyDescriptor(globalThis, "process");
	try {
		Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
	} catch {
		return import("nucleation"); // not configurable: nothing to do but try
	}
	try {
		return await import("nucleation");
	} finally {
		if (own) Object.defineProperty(globalThis, "process", own);
		else host.process = shim;
	}
}

/** Load the shared WASM module only when requested, including from CommonJS bundles. */
export function initializeNucleationWasm(): Promise<void> {
	if (runtime) return Promise.resolve();
	initialization ??= (async () => {
		const host: typeof globalThis & { Nucleation?: NucleationModule } = globalThis;
		runtime = host.Nucleation ?? (await importInBrowserMode());
	})().catch((error: unknown) => {
		initialization = undefined;
		throw error;
	});
	return initialization;
}

/** Synchronous adapter methods require the same explicit initialization as the legacy API. */
export function getNucleation(): NucleationModule {
	if (!runtime) {
		throw new Error("Nucleation is not initialized. Await initializeNucleationWasm() first.");
	}
	return runtime;
}
