/** Keep the cap on its ideal timeline, tolerating sub-millisecond rAF jitter.
 * A strict 16.6667ms test can unnecessarily drop a 16.6ms display frame. */
export function nextFrameTime(now: number, previous: number, interval: number): number | null {
	if (interval <= 0) return now;
	const elapsed = now - previous;
	const tolerance = Math.min(1, interval * 0.05);
	if (elapsed + tolerance < interval) return null;
	return previous + Math.floor((elapsed + tolerance) / interval) * interval;
}
