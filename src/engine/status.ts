import type { StatusDelta, SudacchiState } from "./types.js";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function applyStatusChange(
	state: SudacchiState,
	delta: StatusDelta,
): SudacchiState {
	return {
		...state,
		hunger: clamp(state.hunger + (delta.hunger ?? 0), 0, 100),
		mood: clamp(state.mood + (delta.mood ?? 0), 0, 100),
		energy: clamp(state.energy + (delta.energy ?? 0), 0, 100),
	};
}

/** Apply time-based decay. Returns updated state with zero-since timestamps. */
export function tickStatus(state: SudacchiState, elapsedMinutes: number, now: Date): SudacchiState {
	const hungerDecay = (5 / 60) * elapsedMinutes;
	const moodDecay = (3 / 60) * elapsedMinutes;
	const energyDecay = (2 / 60) * elapsedMinutes;

	const newHunger = clamp(state.hunger - hungerDecay, 0, 100);
	const newMood = clamp(state.mood - moodDecay, 0, 100);
	const newEnergy = clamp(state.energy - energyDecay, 0, 100);

	let hungerZeroSince = state.hungerZeroSince;
	if (newHunger === 0 && !hungerZeroSince) hungerZeroSince = now;
	if (newHunger > 0) hungerZeroSince = null;

	let moodZeroSince = state.moodZeroSince;
	if (newMood === 0 && !moodZeroSince) moodZeroSince = now;
	if (newMood > 0) moodZeroSince = null;

	const allLow = newHunger <= 20 && newMood <= 20 && newEnergy <= 20;
	let allLowSince = state.allLowSince;
	if (allLow && !allLowSince) allLowSince = now;
	if (!allLow) allLowSince = null;

	return {
		...state,
		hunger: newHunger,
		mood: newMood,
		energy: newEnergy,
		hungerZeroSince,
		moodZeroSince,
		allLowSince,
	};
}

/** Apply sleep-time recovery. Energy recovers, hunger/mood decay at half rate. */
export function tickSleepStatus(state: SudacchiState, elapsedMinutes: number, now: Date): SudacchiState {
	const energyRecovery = (18 / 60) * elapsedMinutes; // +3 per 10min tick
	const hungerDecay = (2.5 / 60) * elapsedMinutes;   // half of normal (5/hr → 2.5/hr)
	const moodDecay = (1.5 / 60) * elapsedMinutes;     // half of normal (3/hr → 1.5/hr)

	const newEnergy = clamp(state.energy + energyRecovery, 0, 100);
	const newHunger = clamp(state.hunger - hungerDecay, 0, 100);
	const newMood = clamp(state.mood - moodDecay, 0, 100);

	let hungerZeroSince = state.hungerZeroSince;
	if (newHunger === 0 && !hungerZeroSince) hungerZeroSince = now;
	if (newHunger > 0) hungerZeroSince = null;

	let moodZeroSince = state.moodZeroSince;
	if (newMood === 0 && !moodZeroSince) moodZeroSince = now;
	if (newMood > 0) moodZeroSince = null;

	return {
		...state,
		hunger: newHunger,
		mood: newMood,
		energy: newEnergy,
		hungerZeroSince,
		moodZeroSince,
	};
}

/** Check if auto-wake should happen (energy >= 100 and outside 23:00-9:00). */
export function shouldAutoWake(state: SudacchiState, now: Date): boolean {
	if (!state.isSleeping) return false;
	if (state.energy < 100) return false;
	const hour = now.getHours();
	// 23:00-8:59 は自動起床しない
	if (hour >= 23 || hour < 9) return false;
	return true;
}

/** Format the status bar for display. */
export function formatStatusBar(
	state: SudacchiState,
	delta?: StatusDelta,
): string {
	const bar = (value: number) => {
		const rounded = Math.round(value);
		const filled = Math.round(rounded / 10);
		const empty = 10 - filled;
		return "█".repeat(filled) + "░".repeat(empty);
	};

	const deltaStr = (key: keyof StatusDelta) => {
		const d = delta?.[key];
		if (!d) return "";
		return d > 0 ? `  (+${d})` : `  (${d})`;
	};

	const pad = (n: number) => String(Math.round(n)).padStart(3, " ");

	if (state.isSleeping) {
		return [
			`🍚 ${bar(state.hunger)} ${pad(state.hunger)}`,
			`😊 ${bar(state.mood)} ${pad(state.mood)}`,
			`⚡ ${bar(state.energy)} ${pad(state.energy)}  💤 回復中...`,
		].join("\n");
	}

	return [
		`🍚 ${bar(state.hunger)} ${pad(state.hunger)}${deltaStr("hunger")}`,
		`😊 ${bar(state.mood)} ${pad(state.mood)}${deltaStr("mood")}`,
		`⚡ ${bar(state.energy)} ${pad(state.energy)}${deltaStr("energy")}`,
	].join("\n");
}
