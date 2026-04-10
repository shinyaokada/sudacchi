import emojiData from "unicode-emoji-json";
import type { StatusDelta } from "./types.js";
import { detectFood, getFoodDelta } from "./food.js";

export type ReactionCategory =
	| "food_and_drink"
	| "animals_and_nature"
	| "activities"
	| "travel_and_places"
	| "other";

export interface ReactionResult {
	category: ReactionCategory;
	actionType: "feed" | "play" | "pet" | "event" | "talk";
	delta: StatusDelta;
}

// slug（Slackショートコード相当）→ { emoji, group } の逆引きマップを構築
const slugToEmoji = new Map<string, { emoji: string; group: string }>();
for (const [emoji, info] of Object.entries(emojiData)) {
	slugToEmoji.set(info.slug, { emoji, group: info.group });
}

const GROUP_TO_CATEGORY: Record<string, ReactionCategory> = {
	"Food & Drink": "food_and_drink",
	"Animals & Nature": "animals_and_nature",
	"Activities": "activities",
	"Travel & Places": "travel_and_places",
};

/** min以上max以下のランダム整数を返す */
export function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** リアクションのショートコードからカテゴリを判定する */
export function classifyReaction(shortcode: string): ReactionCategory {
	const entry = slugToEmoji.get(shortcode);
	if (!entry) return "other";
	return GROUP_TO_CATEGORY[entry.group] ?? "other";
}

/** ショートコードからUnicode絵文字を取得する */
export function shortcodeToEmoji(shortcode: string): string | null {
	return slugToEmoji.get(shortcode)?.emoji ?? null;
}

/** カテゴリに応じたステータス変動値を算出する */
export function getReactionDelta(category: ReactionCategory, shortcode: string): ReactionResult {
	switch (category) {
		case "food_and_drink": {
			// ショートコードからUnicode絵文字に変換し、既存の food.ts マッピングを流用
			const emoji = shortcodeToEmoji(shortcode);
			if (emoji) {
				const food = detectFood(emoji);
				if (food) {
					return { category, actionType: "feed", delta: getFoodDelta(food) };
				}
			}
			// マッピングに存在しない Food & Drink 絵文字は一律
			return { category, actionType: "feed", delta: { hunger: 15, mood: 10 } };
		}

		case "animals_and_nature":
			return {
				category,
				actionType: "pet",
				delta: {
					hunger: -randInt(3, 10),
					mood: randInt(8, 20),
				},
			};

		case "activities":
			return {
				category,
				actionType: "play",
				delta: {
					hunger: -randInt(5, 15),
					energy: -randInt(2, 5),
					mood: randInt(3, 8),
				},
			};

		case "travel_and_places":
			return {
				category,
				actionType: "event",
				delta: {
					hunger: randInt(-10, 20),
					mood: randInt(-10, 20),
					energy: randInt(-10, 20),
				},
			};

		case "other":
			return {
				category,
				actionType: "talk",
				delta: {},
			};
	}
}
