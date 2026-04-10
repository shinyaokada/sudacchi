# リアクション機能 仕様書

## 概要

Slackのリアクション（絵文字リアクション）を通じてスダッチとインタラクションできる機能。
ユーザーがスダッチの最新投稿にリアクションを付けると、絵文字のカテゴリに応じてステータスが変動し、スダッチがテキストで反応する。

## 対象メッセージ

- **スダッチ（bot）の最新投稿のみ** に対するリアクションを処理する
- それ以外のメッセージへのリアクションは無視する

## 絵文字カテゴリとアクション対応

Unicodeの絵文字カテゴリに基づいて、リアクションをアクションに分類する。

### Food & Drink（フード＆ドリンク）

- **アクション**: `feed`
- **効果**: 既存の `food.ts` マッピングと同じ
  - staple: hunger +30, mood +5
  - side: hunger +20, mood +10
  - snack: hunger +10, mood +20
  - fruit: hunger +15, mood +15
  - junk: hunger +25, mood +15
  - sudachi: hunger +25, mood +30
- **備考**: `food.ts` のマッピングに存在しない Food & Drink 絵文字は一律 hunger +15, mood +10 とする

### Animals & Nature（動物＆自然）

- **アクション**: `pet`
- **効果**:
  - hunger: -3 〜 -10（ランダム）
  - mood: +8 〜 +20（ランダム）

### Activities（アクティビティ）

- **アクション**: `play`
- **効果**:
  - hunger: -5 〜 -15（ランダム）
  - energy: -2 〜 -5（ランダム）
  - mood: +3 〜 +8（ランダム）

### Travel & Places（トラベル＆場所）

- **アクション**: `event`
- **効果**: 各パラメータがランダムに変動（平均的にはプラス）
  - hunger: -10 〜 +20（ランダム）
  - mood: -10 〜 +20（ランダム）
  - energy: -10 〜 +20（ランダム）

### その他のカテゴリ

- 上記カテゴリに該当しない絵文字やカスタム絵文字は `talk` として扱う
- ステータス変動なし、AI生成の返答のみ

## スダッチの反応

- リアクションに対して **テキストメッセージ** で返答する（AI生成）
- 毎回返答する（間引きなし）

## クールダウン

- **2秒** のクールダウンを設ける
- **ユーザー単位** で管理する
- クールダウン中のリアクションは無視する（処理しない）

## 絵文字カテゴリの判別方法

- Slackの `reaction_added` イベントはショートコード（例: `pizza`, `dog`）で通知される
- ショートコードからUnicode絵文字への変換が必要
- npmパッケージ（例: `unicode-emoji-json`）等を利用してカテゴリを判定する
- Slackカスタム絵文字（`:sudachi:` 等）は個別対応する

## 既存機能との関係

- テキストメッセージでの食べ物絵文字送信（既存の `detectFood`）はそのまま維持
- リアクションによる Food & Drink の効果量はテキスト送信と同一

---

## 実装ガイド

### 1. 新規ファイル

#### `src/engine/reaction.ts`

絵文字カテゴリの判定とステータス変動値の算出を担当する。

```typescript
import type { StatusDelta } from "./types.js";
import { detectFood, getFoodDelta } from "./food.js";

// unicode-emoji-json パッケージからカテゴリを取得する想定
// ショートコード → Unicode変換 → カテゴリ判定

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

/** min以上max以下のランダム整数を返す */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** リアクションのショートコードからカテゴリを判定する */
export function classifyReaction(shortcode: string): ReactionCategory {
  // unicode-emoji-json 等を使って判定
  // カスタム絵文字はここでは "other" を返す
  // 実装時にパッケージ選定の上で詳細を決定
}

/** カテゴリに応じたステータス変動値を算出する */
export function getReactionDelta(category: ReactionCategory, shortcode: string): ReactionResult {
  switch (category) {
    case "food_and_drink": {
      // 既存の food.ts マッピングを流用
      // ショートコードからUnicode絵文字に変換し detectFood に渡す
      // マッピングに存在しない場合は一律 hunger +15, mood +10
      const fallbackDelta: StatusDelta = { hunger: 15, mood: 10 };
      // TODO: ショートコード → Unicode変換後に detectFood を呼ぶ
      return { category, actionType: "feed", delta: fallbackDelta };
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
```

### 2. 既存ファイルの変更

#### `src/slack/app.ts`

`reaction_added` イベントリスナーを追加する。

```typescript
// --- 追加: リアクション処理 ---

/** ユーザーごとの最終リアクション処理時刻（クールダウン管理） */
const reactionCooldowns = new Map<string, number>();
const REACTION_COOLDOWN_MS = 2000; // 2秒

/** botの最新投稿のtsを保持 */
let latestBotMessageTs: string | undefined;

// say() や chat.postMessage() でbotが投稿するたびに latestBotMessageTs を更新する
// （既存の say() 呼び出し箇所を修正して ts を取得・保存する）

app.event("reaction_added", async ({ event }) => {
  // 対象チャンネルのみ
  if (event.item.channel !== config.SUDACCHI_CHANNEL_ID) return;

  // botの最新投稿に対するリアクションのみ
  if (event.item.ts !== latestBotMessageTs) return;

  // bot自身のリアクションは無視
  if (event.user === botUserId) return;

  // クールダウンチェック
  const now = Date.now();
  const lastTime = reactionCooldowns.get(event.user) ?? 0;
  if (now - lastTime < REACTION_COOLDOWN_MS) return;
  reactionCooldowns.set(event.user, now);

  // 絵文字カテゴリ判定 → ステータス変動 → AI応答生成 → 投稿
  // classifyReaction(event.reaction) でカテゴリ判定
  // getReactionDelta() でステータス変動値を算出
  // handleMessage() 相当の処理を実行（またはリアクション用ハンドラを新設）
});
```

#### `src/engine/types.ts`

`StatusDelta` 型に `energy` フィールドが未定義の場合は追加が必要。

```typescript
// 既存の StatusDelta に energy が含まれていなければ追加
export interface StatusDelta {
  hunger?: number;
  mood?: number;
  energy?: number;
}
```

### 3. 依存パッケージの追加

```bash
pnpm add unicode-emoji-json
```

ショートコードからUnicode絵文字への変換、およびカテゴリ判定に使用する。

### 4. テスト

#### `src/tests/reaction/reaction.test.ts`

API不要のユニットテスト。vitest で実行する。

```typescript
import { describe, it, expect } from "vitest";
import {
  classifyReaction,
  getReactionDelta,
  type ReactionCategory,
} from "../../engine/reaction.js";

// --- カテゴリ判定テスト ---

describe("classifyReaction", () => {
  it("Food & Drink のショートコードを正しく判定する", () => {
    expect(classifyReaction("pizza")).toBe("food_and_drink");
    expect(classifyReaction("beer")).toBe("food_and_drink");
    expect(classifyReaction("rice")).toBe("food_and_drink");
    expect(classifyReaction("sushi")).toBe("food_and_drink");
  });

  it("Animals & Nature のショートコードを正しく判定する", () => {
    expect(classifyReaction("dog")).toBe("animals_and_nature");
    expect(classifyReaction("cat")).toBe("animals_and_nature");
    expect(classifyReaction("cherry_blossom")).toBe("animals_and_nature");
    expect(classifyReaction("evergreen_tree")).toBe("animals_and_nature");
  });

  it("Activities のショートコードを正しく判定する", () => {
    expect(classifyReaction("soccer")).toBe("activities");
    expect(classifyReaction("video_game")).toBe("activities");
    expect(classifyReaction("musical_note")).toBe("activities");
  });

  it("Travel & Places のショートコードを正しく判定する", () => {
    expect(classifyReaction("airplane")).toBe("travel_and_places");
    expect(classifyReaction("house")).toBe("travel_and_places");
    expect(classifyReaction("mountain")).toBe("travel_and_places");
  });

  it("該当しない絵文字やカスタム絵文字は other を返す", () => {
    expect(classifyReaction("sudachi")).toBe("other");
    expect(classifyReaction("unknown_custom_emoji")).toBe("other");
  });
});

// --- ステータス変動テスト ---

describe("getReactionDelta", () => {
  describe("Food & Drink", () => {
    it("food.ts に存在する絵文字は既存マッピングの効果量を返す", () => {
      const result = getReactionDelta("food_and_drink", "pizza");
      expect(result.actionType).toBe("feed");
      expect(result.delta.hunger).toBeGreaterThan(0);
      expect(result.delta.mood).toBeGreaterThan(0);
    });

    it("food.ts に存在しない Food 絵文字は一律 hunger +15, mood +10", () => {
      const result = getReactionDelta("food_and_drink", "some_unknown_food");
      expect(result.actionType).toBe("feed");
      expect(result.delta.hunger).toBe(15);
      expect(result.delta.mood).toBe(10);
    });
  });

  describe("Animals & Nature", () => {
    it("actionType が pet である", () => {
      const result = getReactionDelta("animals_and_nature", "dog");
      expect(result.actionType).toBe("pet");
    });

    it("hunger が -3 〜 -10 の範囲", () => {
      for (let i = 0; i < 50; i++) {
        const result = getReactionDelta("animals_and_nature", "dog");
        expect(result.delta.hunger).toBeGreaterThanOrEqual(-10);
        expect(result.delta.hunger).toBeLessThanOrEqual(-3);
      }
    });

    it("mood が +8 〜 +20 の範囲", () => {
      for (let i = 0; i < 50; i++) {
        const result = getReactionDelta("animals_and_nature", "dog");
        expect(result.delta.mood).toBeGreaterThanOrEqual(8);
        expect(result.delta.mood).toBeLessThanOrEqual(20);
      }
    });
  });

  describe("Activities", () => {
    it("actionType が play である", () => {
      const result = getReactionDelta("activities", "soccer");
      expect(result.actionType).toBe("play");
    });

    it("hunger が -5 〜 -15 の範囲", () => {
      for (let i = 0; i < 50; i++) {
        const result = getReactionDelta("activities", "soccer");
        expect(result.delta.hunger).toBeGreaterThanOrEqual(-15);
        expect(result.delta.hunger).toBeLessThanOrEqual(-5);
      }
    });

    it("energy が -2 〜 -5 の範囲", () => {
      for (let i = 0; i < 50; i++) {
        const result = getReactionDelta("activities", "soccer");
        expect(result.delta.energy).toBeGreaterThanOrEqual(-5);
        expect(result.delta.energy).toBeLessThanOrEqual(-2);
      }
    });

    it("mood が +3 〜 +8 の範囲", () => {
      for (let i = 0; i < 50; i++) {
        const result = getReactionDelta("activities", "soccer");
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
```

#### テスト実行方法

```bash
npm test
```

API呼び出しを伴わないため、`ANTHROPIC_API_KEY` の設定は不要。
既存のスナップショットテストと同時に実行される（スナップショットテスト側はAPIキーがないとスキップまたは失敗する）。

リアクション機能のテストだけを実行したい場合:

```bash
npx vitest run src/tests/reaction/
```
