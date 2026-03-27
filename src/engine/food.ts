import type { StatusDelta } from "./types.js";

export interface FoodInfo {
	emoji: string;
	category: string;
	hunger: number;
	mood: number;
}

const FOOD_ENTRIES: FoodInfo[] = [
	// 主食
	{ emoji: "🍚", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍞", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍝", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍜", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍛", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍙", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍘", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🍱", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🌮", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🌯", category: "staple", hunger: 30, mood: 5 },
	{ emoji: "🥐", category: "staple", hunger: 30, mood: 5 },

	// おかず
	{ emoji: "🍗", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🥗", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🍲", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🥩", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🍖", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🥚", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🧆", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🥟", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🍣", category: "side", hunger: 20, mood: 10 },
	{ emoji: "🍤", category: "side", hunger: 20, mood: 10 },

	// おやつ
	{ emoji: "🍰", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍫", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍦", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍩", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍪", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🧁", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍡", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🍮", category: "snack", hunger: 10, mood: 20 },
	{ emoji: "🎂", category: "snack", hunger: 10, mood: 20 },

	// フルーツ
	{ emoji: "🍊", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍎", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍇", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍌", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍓", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍑", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍉", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🥝", category: "fruit", hunger: 15, mood: 15 },
	{ emoji: "🍋", category: "fruit", hunger: 15, mood: 15 },

	// ジャンク
	{ emoji: "🍕", category: "junk", hunger: 25, mood: 15 },
	{ emoji: "🍔", category: "junk", hunger: 25, mood: 15 },
	{ emoji: "🌭", category: "junk", hunger: 25, mood: 15 },
	{ emoji: "🍟", category: "junk", hunger: 25, mood: 15 },
];

const FOOD_EMOJI_MAP = new Map<string, FoodInfo>(
	FOOD_ENTRIES.map((f) => [f.emoji, f]),
);

/** Segmenter for splitting user input into grapheme clusters (handles emoji correctly). */
const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });

/**
 * Detect if the message is purely food emoji.
 * Returns FoodInfo if a single food emoji is detected, null otherwise.
 */
export function detectFood(message: string): FoodInfo | null {
	const trimmed = message.trim();
	if (!trimmed) return null;

	// Check for sudachi custom emoji
	if (trimmed.includes(":sudachi:")) {
		return { emoji: ":sudachi:", category: "sudachi", hunger: 25, mood: 30 };
	}

	// Split into grapheme clusters
	const segments = [...segmenter.segment(trimmed)].map((s) => s.segment);

	// Check if all segments are the same food emoji (pure emoji message)
	const unique = new Set(segments);
	if (unique.size === 1 && FOOD_EMOJI_MAP.has(segments[0])) {
		return FOOD_EMOJI_MAP.get(segments[0])!;
	}

	// Check if message contains any food emoji (mixed text+emoji)
	for (const seg of segments) {
		const food = FOOD_EMOJI_MAP.get(seg);
		if (food) return food;
	}

	return null;
}

export function getFoodDelta(food: FoodInfo): StatusDelta {
	return { hunger: food.hunger, mood: food.mood };
}
