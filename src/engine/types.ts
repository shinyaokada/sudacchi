export type Stage = "egg" | "baby" | "child" | "adult" | "veteran";
export type ActionType = "feed" | "play" | "pet" | "sleep" | "wake" | "talk" | "event";

export interface SudacchiState {
	id: string;
	name: string;
	stage: Stage;
	hunger: number;
	mood: number;
	energy: number;
	isSleeping: boolean;
	bornAt: Date;
	diedAt: Date | null;
	lastFedAt: Date | null;
	lastPlayedAt: Date | null;
	lastSleptAt: Date | null;
	lastInteractionAt: Date | null;
	hungerZeroSince: Date | null;
	moodZeroSince: Date | null;
	allLowSince: Date | null;
}

export interface StatusDelta {
	hunger?: number;
	mood?: number;
	energy?: number;
}
