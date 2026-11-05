export interface CpuFrameTiming {
	controlsMs: number;
	highlightMs: number;
	gizmoMs: number;
	visibilityMs: number;
	submitMs: number;
	measuredMs: number;
}
export const CPU_TIMING_KEYS = [
	"controlsMs",
	"highlightMs",
	"gizmoMs",
	"visibilityMs",
	"submitMs",
	"measuredMs",
] as const;
/** Fixed-capacity ring. Aggregation/sorting happens only when a consumer requests a snapshot. */
export class CpuFrameProfiler {
	private samples: CpuFrameTiming[] = [];
	private cursor = 0;
	constructor(private capacity = 120) {
		if (!Number.isInteger(capacity) || capacity <= 0)
			throw new RangeError("Invalid profiler capacity");
	}
	reset(): void {
		this.samples.length = 0;
		this.cursor = 0;
	}
	record(sample: CpuFrameTiming): void {
		if (CPU_TIMING_KEYS.some((key) => !Number.isFinite(sample[key]) || sample[key] < 0)) return;
		this.samples[this.cursor] = { ...sample };
		this.cursor = (this.cursor + 1) % this.capacity;
	}
	snapshot(): { samples: number; mean: CpuFrameTiming; p95: CpuFrameTiming } {
		const mean = {} as CpuFrameTiming,
			p95 = {} as CpuFrameTiming;
		for (const key of CPU_TIMING_KEYS) {
			const values = this.samples.map((sample) => sample[key]).sort((a, b) => a - b);
			mean[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
			p95[key] = values.length ? values[Math.ceil(values.length * 0.95) - 1] : 0;
		}
		return { samples: this.samples.length, mean, p95 };
	}
}
