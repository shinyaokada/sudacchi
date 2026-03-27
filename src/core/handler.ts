import { classifyAction, generateResponse } from "../ai/client.js";
import { buildFeedContext, buildSystemPrompt } from "../ai/prompt.js";
import type { Db } from "../db/client.js";
import { getOrCreateBond, updateBond } from "../db/repository/bond.js";
import { createLog, getRecentLogs } from "../db/repository/log.js";
import { getSudacchiById, updateSudacchi } from "../db/repository/sudacchi.js";
import { detectFood, getFoodDelta } from "../engine/food.js";
import { applyStatusChange, formatStatusBar } from "../engine/status.js";
import type { ActionType, StatusDelta, SudacchiState } from "../engine/types.js";

export interface HandleResult {
	response: string;
	statusBar: string;
	action: ActionType;
}

function dbRowToState(row: NonNullable<ReturnType<typeof getSudacchiById>>): SudacchiState {
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

export async function handleMessage(
	db: Db,
	input: { userId: string; message: string; sudacchiId: string },
): Promise<HandleResult> {
	const row = getSudacchiById(db, input.sudacchiId);
	if (!row) throw new Error("Sudacchi not found");

	let state = dbRowToState(row);
	const now = new Date();

	// Dead check
	if (state.diedAt) {
		return {
			response: "...（スダッチはもういません）",
			statusBar: "",
			action: "talk",
		};
	}

	// Sleeping check
	if (state.isSleeping) {
		return {
			response: "zzZ...zzZ...（スダッチは寝ています）",
			statusBar: formatStatusBar(state),
			action: "talk",
		};
	}

	// Detect food emoji
	const food = detectFood(input.message);
	let action: ActionType;
	let delta: StatusDelta = {};
	let extraContext = "";

	if (food) {
		action = "feed";
		delta = getFoodDelta(food);
		extraContext = buildFeedContext(food.emoji, food.category);
	} else {
		// Classify via AI
		action = await classifyAction(input.message);

		switch (action) {
			case "feed":
				delta = { hunger: 20, mood: 10 };
				break;
			case "pet":
				delta = { mood: 5 };
				break;
			case "play":
				delta = { mood: 20, energy: -10 };
				break;
			case "sleep":
				state = { ...state, isSleeping: true };
				break;
			case "talk":
			default:
				break;
		}
	}

	// Apply status changes
	if (delta.hunger || delta.mood || delta.energy) {
		state = applyStatusChange(state, delta);
	}

	// Update zero-since timestamps
	if (state.hunger > 0) state = { ...state, hungerZeroSince: null };
	if (state.mood > 0) state = { ...state, moodZeroSince: null };
	const allOk = state.hunger > 20 || state.mood > 20 || state.energy > 20;
	if (allOk) state = { ...state, allLowSince: null };

	// Build AI prompt
	const bond = getOrCreateBond(db, input.userId, input.sudacchiId);
	const systemPrompt = buildSystemPrompt(state, bond);

	// Build messages (recent conversation + current)
	const recentLogs = getRecentLogs(db, input.sudacchiId, 10);
	const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
	for (const log of recentLogs.reverse()) {
		if (log.type === "talk" || log.type === "feed" || log.type === "play" || log.type === "pet") {
			const detail = log.detail ? JSON.parse(log.detail) : {};
			if (detail.userMessage) {
				conversationMessages.push({ role: "user", content: detail.userMessage });
			}
			if (detail.response) {
				conversationMessages.push({ role: "assistant", content: detail.response });
			}
		}
	}

	const userContent = extraContext
		? `${extraContext}\n\nユーザーのメッセージ: ${input.message}`
		: input.message;
	conversationMessages.push({ role: "user", content: userContent });

	// Generate AI response
	const response = await generateResponse(systemPrompt, conversationMessages);
	const statusBar = formatStatusBar(state, delta);

	// Persist state
	updateSudacchi(db, input.sudacchiId, {
		hunger: state.hunger,
		mood: state.mood,
		energy: state.energy,
		isSleeping: state.isSleeping,
		lastInteractionAt: now,
		...(action === "feed" ? { lastFedAt: now } : {}),
		...(action === "play" ? { lastPlayedAt: now } : {}),
		...(action === "sleep" ? { lastSleptAt: now } : {}),
		hungerZeroSince: state.hungerZeroSince,
		moodZeroSince: state.moodZeroSince,
		allLowSince: state.allLowSince,
	});

	// Update bond
	updateBond(db, input.userId, input.sudacchiId, {
		bond: Math.min(100, bond.bond + (action === "talk" ? 1 : 2)),
		lastInteractionAt: now,
		...(action === "feed" ? { totalFeeds: bond.totalFeeds + 1 } : {}),
		...(action === "play" ? { totalPlays: bond.totalPlays + 1 } : {}),
		...(action === "pet" ? { totalPets: bond.totalPets + 1 } : {}),
	});

	// Log interaction
	createLog(db, {
		sudacchiId: input.sudacchiId,
		userId: input.userId,
		type: action,
		detail: JSON.stringify({ userMessage: input.message, response }),
		createdAt: now,
	});

	return { response, statusBar, action };
}
