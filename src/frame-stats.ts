/** Frame submission intervals, not monitor refresh callbacks or GPU timing. */
export class FrameStats {
	active = false;
	previous: number | null = null;
	samples: { at: number; ms: number }[] = [];
	constructor() {
		this.reset();
	}
	reset() {
		this.active = false;
		this.previous = null;
		this.samples = [];
	}
	idle() {
		this.active = false;
		this.previous = null;
	}
	record(timestamp: number) {
		if (!Number.isFinite(timestamp)) return;
		if (this.previous !== null && timestamp <= this.previous) return;
		this.active = true;
		if (this.previous !== null && timestamp > this.previous) {
			this.samples.push({ at: timestamp, ms: timestamp - this.previous });
		}
		this.previous = timestamp;
		this.prune(timestamp);
	}
	prune(now: number) {
		let remove = 0;
		while (remove < this.samples.length && this.samples[remove].at < now - 10000) remove++;
		remove = Math.max(remove, this.samples.length - 4096);
		if (remove > 0) this.samples.splice(0, remove);
	}
	snapshot(now: number) {
		this.prune(now);
		const recent = this.samples.filter((sample) => sample.at >= now - 1000);
		const sum = recent.reduce((total, sample) => total + sample.ms, 0);
		const fps = this.active && sum > 0 ? (1000 * recent.length) / sum : 0;
		let low: number | null = null;
		if (this.samples.length >= 100) {
			const slowest = this.samples.map((sample) => sample.ms).sort((a, b) => b - a);
			const count = Math.ceil(slowest.length * 0.01);
			low = (1000 * count) / slowest.slice(0, count).reduce((total, ms) => total + ms, 0);
		}
		return { fps, low, active: this.active, samples: this.samples.length };
	}
}
