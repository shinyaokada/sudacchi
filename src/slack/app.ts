import { App } from "@slack/bolt";
import cron from "node-cron";
import { config } from "../config.js";
import { handleMessage } from "../core/handler.js";
import { db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { getOrCreateBond, updateBond } from "../db/repository/bond.js";
import { createLog } from "../db/repository/log.js";
import { getAliveSudacchi, updateSudacchi } from "../db/repository/sudacchi.js";
import { classifyReaction, getReactionDelta, shortcodeToEmoji } from "../engine/reaction.js";
import { applyStatusChange, formatStatusBar } from "../engine/status.js";
import { executeDeathCheck } from "../scheduler/death-check.js";
import { executeTick } from "../scheduler/tick.js";
import { buildFeedContext, buildSystemPrompt } from "../ai/prompt.js";
import { generateResponse } from "../ai/client.js";

runMigrations(db);

const app = new App({
	token: config.SLACK_BOT_TOKEN!,
	signingSecret: config.SLACK_SIGNING_SECRET!,
	appToken: config.SLACK_APP_TOKEN!,
	socketMode: true,
});

let botUserId: string | undefined;

/** botの最新投稿のtsを保持 */
let latestBotMessageTs: string | undefined;

/** ユーザーごとの最終リアクション処理時刻（クールダウン管理） */
const reactionCooldowns = new Map<string, number>();
const REACTION_COOLDOWN_MS = 2000;

// Listen to all messages in the sudacchi channel
app.message(async ({ message, say }) => {
	const msg = message as { subtype?: string; bot_id?: string; channel: string; user: string; text?: string };

	// Ignore bot messages (including own)
	if (msg.subtype || msg.bot_id) return;

	// Only respond in the designated channel
	if (msg.channel !== config.SUDACCHI_CHANNEL_ID) return;

	// Ignore messages that mention other users (not the bot)
	const mentions = msg.text?.match(/<@(U[A-Z0-9]+)>/g) ?? [];
	const hasOtherMention = mentions.some((m) => m !== `<@${botUserId}>`);
	if (hasOtherMention) return;

	let sudacchi = getAliveSudacchi(db);
	if (!sudacchi) {
		const { randomUUID } = await import("node:crypto");
		const { createSudacchi } = await import("../db/repository/sudacchi.js");
		sudacchi = createSudacchi(db, randomUUID(), new Date());
		const posted = await say("🥚 スダッチが生まれました！");
		if (posted?.ts) latestBotMessageTs = posted.ts;
		return;
	}

	try {
		const result = await handleMessage(db, {
			userId: msg.user,
			message: msg.text ?? "",
			sudacchiId: sudacchi.id,
		});

		const text = result.statusBar
			? `${result.response}\n${result.statusBar}`
			: result.response;

		const posted = await say(text);
		if (posted?.ts) latestBotMessageTs = posted.ts;
	} catch (err) {
		console.error("Error handling message:", err);
	}
});

// --- リアクション処理 ---
app.event("reaction_added", async ({ event }) => {
	// 対象チャンネルのみ
	if (event.item.type !== "message") return;
	if ((event.item as { channel: string }).channel !== config.SUDACCHI_CHANNEL_ID) return;

	// botの最新投稿に対するリアクションのみ
	if ((event.item as { ts: string }).ts !== latestBotMessageTs) return;

	// bot自身のリアクションは無視
	if (event.user === botUserId) return;

	// クールダウンチェック
	const now = Date.now();
	const lastTime = reactionCooldowns.get(event.user) ?? 0;
	if (now - lastTime < REACTION_COOLDOWN_MS) return;
	reactionCooldowns.set(event.user, now);

	const sudacchi = getAliveSudacchi(db);
	if (!sudacchi || sudacchi.diedAt) return;

	// 寝ている間はリアクションに反応しない
	if (sudacchi.isSleeping) return;

	const shortcode = event.reaction;
	const category = classifyReaction(shortcode);
	const reactionResult = getReactionDelta(category, shortcode);

	// ステータス変動を適用
	let state = {
		id: sudacchi.id, name: sudacchi.name, stage: sudacchi.stage,
		hunger: sudacchi.hunger, mood: sudacchi.mood, energy: sudacchi.energy,
		isSleeping: sudacchi.isSleeping, bornAt: sudacchi.bornAt, diedAt: sudacchi.diedAt,
		lastFedAt: sudacchi.lastFedAt, lastPlayedAt: sudacchi.lastPlayedAt,
		lastSleptAt: sudacchi.lastSleptAt, lastInteractionAt: sudacchi.lastInteractionAt,
		hungerZeroSince: sudacchi.hungerZeroSince, moodZeroSince: sudacchi.moodZeroSince,
		allLowSince: sudacchi.allLowSince,
	};

	if (reactionResult.delta.hunger || reactionResult.delta.mood || reactionResult.delta.energy) {
		state = applyStatusChange(state, reactionResult.delta);
	}

	// zero-since タイムスタンプ更新
	if (state.hunger > 0) state = { ...state, hungerZeroSince: null };
	if (state.mood > 0) state = { ...state, moodZeroSince: null };
	const allOk = state.hunger > 20 || state.mood > 20 || state.energy > 20;
	if (allOk) state = { ...state, allLowSince: null };

	// AI応答を生成
	const bond = getOrCreateBond(db, event.user, sudacchi.id);
	const systemPrompt = buildSystemPrompt(state, bond);

	const emoji = shortcodeToEmoji(shortcode) ?? `:${shortcode}:`;
	let userContent: string;
	if (reactionResult.actionType === "feed") {
		const feedCategory = reactionResult.delta.hunger === 15 ? "unknown" : "food";
		userContent = shortcode === "sudachi"
			? buildFeedContext(":sudachi:", "sudachi")
			: `[システム] ユーザーがリアクションで ${emoji} をくれました。食べ物の感想を言ってください。`;
	} else if (reactionResult.actionType === "pet") {
		userContent = `[システム] ユーザーがリアクションで ${emoji} を付けました。なでてもらったように喜んでください。`;
	} else if (reactionResult.actionType === "play") {
		userContent = `[システム] ユーザーがリアクションで ${emoji} を付けました。遊びに誘われたように反応してください。`;
	} else if (reactionResult.actionType === "event") {
		userContent = `[システム] ユーザーがリアクションで ${emoji} を付けました。お出かけやイベントに関する反応をしてください。`;
	} else {
		userContent = `[システム] ユーザーがリアクションで ${emoji} を付けました。自由に反応してください。`;
	}

	try {
		const response = await generateResponse(systemPrompt, [
			{ role: "user", content: userContent },
		]);
		const statusBar = formatStatusBar(state, reactionResult.delta);
		const text = `${response}\n${statusBar}`;

		const posted = await app.client.chat.postMessage({
			channel: config.SUDACCHI_CHANNEL_ID!,
			text,
		});
		if (posted.ts) latestBotMessageTs = posted.ts;

		// DB更新
		const nowDate = new Date();
		updateSudacchi(db, sudacchi.id, {
			hunger: state.hunger,
			mood: state.mood,
			energy: state.energy,
			isSleeping: state.isSleeping,
			lastInteractionAt: nowDate,
			...(reactionResult.actionType === "feed" ? { lastFedAt: nowDate } : {}),
			...(reactionResult.actionType === "play" ? { lastPlayedAt: nowDate } : {}),
			hungerZeroSince: state.hungerZeroSince,
			moodZeroSince: state.moodZeroSince,
			allLowSince: state.allLowSince,
		});

		updateBond(db, event.user, sudacchi.id, {
			bond: Math.min(100, bond.bond + (reactionResult.actionType === "talk" ? 1 : 2)),
			lastInteractionAt: nowDate,
			...(reactionResult.actionType === "feed" ? { totalFeeds: bond.totalFeeds + 1 } : {}),
			...(reactionResult.actionType === "play" ? { totalPlays: bond.totalPlays + 1 } : {}),
			...(reactionResult.actionType === "pet" ? { totalPets: bond.totalPets + 1 } : {}),
		});

		createLog(db, {
			sudacchiId: sudacchi.id,
			userId: event.user,
			type: reactionResult.actionType,
			detail: JSON.stringify({ reaction: shortcode, emoji, response }),
			createdAt: nowDate,
		});
	} catch (err) {
		console.error("Error handling reaction:", err);
	}
});

// Post autonomous message to the channel
async function postAutonomous(text: string) {
	if (!config.SUDACCHI_CHANNEL_ID) return;
	try {
		const posted = await app.client.chat.postMessage({
			channel: config.SUDACCHI_CHANNEL_ID,
			text,
		});
		if (posted.ts) latestBotMessageTs = posted.ts;
	} catch (err) {
		console.error("Error posting autonomous message:", err);
	}
}

// Status decay every 10 minutes (also handles sleep recovery + auto-wake)
cron.schedule("*/10 * * * *", () => {
	const result = executeTick(db, 10);
	if (result) {
		if (result.wokeUp) {
			postAutonomous("ふわぁ〜、よく寝たー！⚡✨");
		}
		const death = executeDeathCheck(db);
		if (death.isDead) {
			postAutonomous(`💀 ${death.reason}\nスダッチは旅立ってしまいました...`);
		}
	}
});

// Autonomous actions every 30 minutes
cron.schedule("*/30 * * * *", async () => {
	const sudacchi = getAliveSudacchi(db);
	if (!sudacchi || sudacchi.diedAt || sudacchi.isSleeping) return;

	const hour = new Date().getHours();

	// No posting during sleep hours (0:00-7:00)
	if (hour >= 0 && hour < 7) return;

	// Check status-based triggers
	const messages: string[] = [];

	if (sudacchi.hunger < 30) {
		messages.push("おなかすいた...だれかごはんくれない？🍚");
	} else if (sudacchi.mood < 20) {
		messages.push("...べつに、さみしくないし");
	} else if (sudacchi.energy < 10) {
		messages.push("zzZ...zzZ...（ウトウト）💤");
	}

	// Check neglect
	if (sudacchi.lastInteractionAt) {
		const elapsed = Date.now() - sudacchi.lastInteractionAt.getTime();
		const hours = elapsed / (1000 * 60 * 60);
		if (hours > 20) {
			messages.length = 0;
			messages.push("たすけて...げんきが...😢");
		} else if (hours > 12) {
			messages.length = 0;
			messages.push("...もう忘れられちゃったのかな");
		} else if (hours > 6) {
			messages.length = 0;
			messages.push("おーい、だれかいないの？");
		}
	}

	if (messages.length > 0) {
		const state = {
			id: sudacchi.id, name: sudacchi.name, stage: sudacchi.stage,
			hunger: sudacchi.hunger, mood: sudacchi.mood, energy: sudacchi.energy,
			isSleeping: sudacchi.isSleeping, bornAt: sudacchi.bornAt, diedAt: sudacchi.diedAt,
			lastFedAt: sudacchi.lastFedAt, lastPlayedAt: sudacchi.lastPlayedAt,
			lastSleptAt: sudacchi.lastSleptAt, lastInteractionAt: sudacchi.lastInteractionAt,
			hungerZeroSince: sudacchi.hungerZeroSince, moodZeroSince: sudacchi.moodZeroSince,
			allLowSince: sudacchi.allLowSince,
		};
		const statusBar = formatStatusBar(state);
		await postAutonomous(`${messages[0]}\n${statusBar}`);
	}
});

// 9:00 — 起床
cron.schedule("0 9 * * *", () => {
	const sudacchi = getAliveSudacchi(db);
	if (sudacchi && !sudacchi.diedAt) {
		if (sudacchi.isSleeping) {
			updateSudacchi(db, sudacchi.id, { isSleeping: false, energy: 100 });
		}
		postAutonomous("おはよ〜！今日もよろしくね！☀️");
	}
});

// 12:00 — 昼の挨拶
cron.schedule("0 12 * * *", () => {
	const sudacchi = getAliveSudacchi(db);
	if (sudacchi && !sudacchi.diedAt && !sudacchi.isSleeping) {
		postAutonomous("おひるだよ！おなかぺこぺこ！🍱");
	}
});

// 23:00 — 就寝
cron.schedule("0 23 * * *", () => {
	const sudacchi = getAliveSudacchi(db);
	if (sudacchi && !sudacchi.diedAt && !sudacchi.isSleeping) {
		updateSudacchi(db, sudacchi.id, { isSleeping: true, lastSleptAt: new Date() });
		postAutonomous("ふわぁ…おやすみなさい💤");
	}
});

export async function startSlack() {
	await app.start();

	// Get bot user ID
	const auth = await app.client.auth.test();
	botUserId = auth.user_id;

	console.log("⚡ Sudacchi is running in Slack mode!");

	// Create initial sudacchi if none exists (silently on startup)
	const sudacchi = getAliveSudacchi(db);
	if (!sudacchi) {
		const { randomUUID } = await import("node:crypto");
		const { createSudacchi } = await import("../db/repository/sudacchi.js");
		createSudacchi(db, randomUUID(), new Date());
		console.log("🥚 New Sudacchi created (startup)");
	}
}
