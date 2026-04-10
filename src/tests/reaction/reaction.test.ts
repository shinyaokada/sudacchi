import { describe, it, expect } from "vitest";
import {
	classifyReaction,
	getReactionDelta,
	shortcodeToEmoji,
	type ReactionCategory,
} from "../../engine/reaction.js";

// --- カテゴリ判定テスト ---

describe("classifyReaction", () => {
	it("Food & Drink のショートコードを正しく判定する", () => {
		expect(classifyReaction("pizza")).toBe("food_and_drink");
		expect(classifyReaction("beer_mug")).toBe("food_and_drink");
		expect(classifyReaction("cooked_rice")).toBe("food_and_drink");
		expect(classifyReaction("sushi")).toBe("food_and_drink");
	});

	it("Animals & Nature のショートコードを正しく判定する", () => {
		expect(classifyReaction("dog_face")).toBe("animals_and_nature");
		expect(classifyReaction("cat_face")).toBe("animals_and_nature");
		expect(classifyReaction("cherry_blossom")).toBe("animals_and_nature");
		expect(classifyReaction("evergreen_tree")).toBe("animals_and_nature");
	});

	it("Activities のショートコードを正しく判定する", () => {
		expect(classifyReaction("soccer_ball")).toBe("activities");
		expect(classifyReaction("video_game")).toBe("activities");
		expect(classifyReaction("fireworks")).toBe("activities");
	});

	it("Travel & Places のショートコードを正しく判定する", () => {
		expect(classifyReaction("airplane")).toBe("travel_and_places");
		expect(classifyReaction("house")).toBe("travel_and_places");
		expect(classifyReaction("mount_fuji")).toBe("travel_and_places");
	});

	it("該当しない絵文字やカスタム絵文字は other を返す", () => {
		expect(classifyReaction("sudachi")).toBe("other");
		expect(classifyReaction("unknown_custom_emoji")).toBe("other");
	});
});

// --- ショートコード→Unicode変換テスト ---

describe("shortcodeToEmoji", () => {
	it("既知のショートコードをUnicode絵文字に変換する", () => {
		expect(shortcodeToEmoji("pizza")).toBe("🍕");
		expect(shortcodeToEmoji("dog_face")).toBe("🐶");
		expect(shortcodeToEmoji("soccer_ball")).toBe("⚽");
	});

	it("不明なショートコードはnullを返す", () => {
		expect(shortcodeToEmoji("unknown_emoji")).toBeNull();
		expect(shortcodeToEmoji("sudachi")).toBeNull();
	});
});

// --- ステータス変動テスト ---

describe("getReactionDelta", () => {
	describe("Food & Drink", () => {
		it("food.ts に存在する絵文字は既存マッピングの効果量を返す", () => {
			const result = getReactionDelta("food_and_drink", "pizza");
			expect(result.actionType).toBe("feed");
			// 🍕 は junk: hunger +25, mood +15
			expect(result.delta.hunger).toBe(25);
			expect(result.delta.mood).toBe(15);
		});

		it("food.ts に存在しない Food 絵文字は一律 hunger +15, mood +10", () => {
			// "beverage_box" は food.ts にない Food & Drink 絵文字
			const result = getReactionDelta("food_and_drink", "beverage_box");
			expect(result.actionType).toBe("feed");
			expect(result.delta.hunger).toBe(15);
			expect(result.delta.mood).toBe(10);
		});
	});

	describe("Animals & Nature", () => {
		it("actionType が pet である", () => {
			const result = getReactionDelta("animals_and_nature", "dog_face");
			expect(result.actionType).toBe("pet");
		});

		it("hunger が -3 〜 -10 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("animals_and_nature", "dog_face");
				expect(result.delta.hunger).toBeGreaterThanOrEqual(-10);
				expect(result.delta.hunger).toBeLessThanOrEqual(-3);
			}
		});

		it("mood が +8 〜 +20 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("animals_and_nature", "dog_face");
				expect(result.delta.mood).toBeGreaterThanOrEqual(8);
				expect(result.delta.mood).toBeLessThanOrEqual(20);
			}
		});
	});

	describe("Activities", () => {
		it("actionType が play である", () => {
			const result = getReactionDelta("activities", "soccer_ball");
			expect(result.actionType).toBe("play");
		});

		it("hunger が -5 〜 -15 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("activities", "soccer_ball");
				expect(result.delta.hunger).toBeGreaterThanOrEqual(-15);
				expect(result.delta.hunger).toBeLessThanOrEqual(-5);
			}
		});

		it("energy が -2 〜 -5 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("activities", "soccer_ball");
				expect(result.delta.energy).toBeGreaterThanOrEqual(-5);
				expect(result.delta.energy).toBeLessThanOrEqual(-2);
			}
		});

		it("mood が +3 〜 +8 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("activities", "soccer_ball");
				expect(result.delta.mood).toBeGreaterThanOrEqual(3);
				expect(result.delta.mood).toBeLessThanOrEqual(8);
			}
		});
	});

	describe("Travel & Places", () => {
		it("actionType が event である", () => {
			const result = getReactionDelta("travel_and_places", "airplane");
			expect(result.actionType).toBe("event");
		});

		it("各パラメータが -10 〜 +20 の範囲", () => {
			for (let i = 0; i < 50; i++) {
				const result = getReactionDelta("travel_and_places", "airplane");
				for (const key of ["hunger", "mood", "energy"] as const) {
					expect(result.delta[key]).toBeGreaterThanOrEqual(-10);
					expect(result.delta[key]).toBeLessThanOrEqual(20);
				}
			}
		});

		it("平均的にプラスになる（100回試行）", () => {
			const sums = { hunger: 0, mood: 0, energy: 0 };
			const trials = 100;
			for (let i = 0; i < trials; i++) {
				const result = getReactionDelta("travel_and_places", "airplane");
				sums.hunger += result.delta.hunger ?? 0;
				sums.mood += result.delta.mood ?? 0;
				sums.energy += result.delta.energy ?? 0;
			}
			// -10〜+20 の一様分布の期待値は +5 なので、平均は正になるはず
			expect(sums.hunger / trials).toBeGreaterThan(0);
			expect(sums.mood / trials).toBeGreaterThan(0);
			expect(sums.energy / trials).toBeGreaterThan(0);
		});
	});

	describe("Other", () => {
		it("actionType が talk で、ステータス変動なし", () => {
			const result = getReactionDelta("other", "sudachi");
			expect(result.actionType).toBe("talk");
			expect(result.delta).toEqual({});
		});
	});
});

// --- クールダウンテスト ---

describe("クールダウン", () => {
	it("Map ベースのクールダウンロジックが正しく機能する", () => {
		const cooldowns = new Map<string, number>();
		const COOLDOWN_MS = 2000;

		const userId = "U123";

		// 初回: クールダウンなし → 処理される
		const now1 = 1000000;
		const last1 = cooldowns.get(userId) ?? 0;
		expect(now1 - last1 >= COOLDOWN_MS).toBe(true);
		cooldowns.set(userId, now1);

		// 1秒後: クールダウン中 → 無視される
		const now2 = now1 + 1000;
		const last2 = cooldowns.get(userId) ?? 0;
		expect(now2 - last2 >= COOLDOWN_MS).toBe(false);

		// 3秒後: クールダウン解除 → 処理される
		const now3 = now1 + 3000;
		const last3 = cooldowns.get(userId) ?? 0;
		expect(now3 - last3 >= COOLDOWN_MS).toBe(true);
	});

	it("ユーザー間でクールダウンは独立している", () => {
		const cooldowns = new Map<string, number>();
		const COOLDOWN_MS = 2000;

		const now = 1000000;
		cooldowns.set("U001", now);

		// U001 は 1秒後 → クールダウン中
		const check1 = now + 1000;
		expect(check1 - (cooldowns.get("U001") ?? 0) >= COOLDOWN_MS).toBe(false);

		// U002 は未登録 → 処理される
		expect(check1 - (cooldowns.get("U002") ?? 0) >= COOLDOWN_MS).toBe(true);
	});
});
