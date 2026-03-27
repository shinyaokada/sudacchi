import type { Db } from "../db/client.js";
import { getAliveSudacchi, updateSudacchi } from "../db/repository/sudacchi.js";
import { tickStatus, tickSleepStatus, shouldAutoWake } from "../engine/status.js";
import type { SudacchiState } from "../engine/types.js";

export interface TickResult {
	previousState: { hunger: number; mood: number; energy: number };
	newState: { hunger: number; mood: number; energy: number };
	wokeUp: boolean;
}

function rowToState(row: NonNullable<ReturnType<typeof getAliveSudacchi>>): SudacchiState {
	return {
		id: row.id,
		name: row.name,
		stage: row.stage,
		hunger: row.hunger,
		mood: row.mood,
		energy: row.energy,
		isSleeping: row.isSleeping,
		bornAt: row.bornAt,
		diedAt: row.diedAt,
		lastFedAt: row.lastFedAt,
		lastPlayedAt: row.lastPlayedAt,
		lastSleptAt: row.lastSleptAt,
		lastInteractionAt: row.lastInteractionAt,
		hungerZeroSince: row.hungerZeroSince,
		moodZeroSince: row.moodZeroSince,
		allLowSince: row.allLowSince,
	};
}

export function executeTick(db: Db, elapsedMinutes: number): TickResult | null {
	const row = getAliveSudacchi(db);
	if (!row) return null;

	const now = new Date();
	const state = rowToState(row);
	const previous = { hunger: state.hunger, mood: state.mood, energy: state.energy };

	let newState: SudacchiState;
	let wokeUp = false;

	if (state.isSleeping) {
		// 睡眠中: energy 回復 + hunger/mood 半減衰
		newState = tickSleepStatus(state, elapsedMinutes, now);

		// 自動起床チェック
		if (shouldAutoWake(newState, now)) {
			newState = { ...newState, isSleeping: false };
			wokeUp = true;
		}
	} else {
		// 起きている: 通常の減衰
		newState = tickStatus(state, elapsedMinutes, now);
	}

	updateSudacchi(db, row.id, {
		hunger: newState.hunger,
		mood: newState.mood,
		energy: newState.energy,
		isSleeping: newState.isSleeping,
		hungerZeroSince: newState.hungerZeroSince,
		moodZeroSince: newState.moodZeroSince,
		allLowSince: newState.allLowSince,
	});

	return {
		previousState: previous,
		newState: { hunger: newState.hunger, mood: newState.mood, energy: newState.energy },
		wokeUp,
	};
}
