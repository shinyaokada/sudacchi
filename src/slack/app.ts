import { App } from "@slack/bolt";
import cron from "node-cron";
import { config } from "../config.js";
import { handleMessage } from "../core/handler.js";
import { db } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { getAliveSudacchi, updateSudacchi } from "../db/repository/sudacchi.js";
import { formatStatusBar } from "../engine/status.js";
import { executeDeathCheck } from "../scheduler/death-check.js";
import { executeTick } from "../scheduler/tick.js";

runMigrations(db);

const app = new App({
	token: config.SLACK_BOT_TOKEN!,
	signingSecret: config.SLACK_SIGNING_SECRET!,
	appToken: config.SLACK_APP_TOKEN!,
	socketMode: true,
});

let botUserId: string | undefined;

// Listen to all messages in the sudacchi channel
app.message(async ({ message, say }) => {
	const msg = message as { subtype?: string; bot_id?: string; channel: string; user: string; text?: string };

	// Ignore bot messages (including own)
	if (msg.subtype || msg.bot_id) return;

	// Only respond in the designated channel
	if (msg.channel !== config.SUDACCHI_CHANNEL_ID) return;

	// Ignore messages that mention the bot (avoid double responses)
	if (botUserId && msg.text?.includes(`<@${botUserId}>`)) {
		// Still respond, just strip the mention
	}

	const sudacchi = getAliveSudacchi(db);
	if (!sudacchi) {
		await say("スダッチはまだいません...🥚");
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

		await say(text);
	} catch (err) {
		console.error("Error handling message:", err);
	}
});

// Post autonomous message to the channel
async function postAutonomous(text: string) {
	if (!config.SUDACCHI_CHANNEL_ID) return;
	try {
		await app.client.chat.postMessage({
			channel: config.SUDACCHI_CHANNEL_ID,
			text,
		});
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

	// Create initial sudacchi if none exists
	const sudacchi = getAliveSudacchi(db);
	if (!sudacchi) {
		const { randomUUID } = await import("node:crypto");
		const { createSudacchi } = await import("../db/repository/sudacchi.js");
		createSudacchi(db, randomUUID(), new Date());
		console.log("🥚 New Sudacchi created!");
		if (config.SUDACCHI_CHANNEL_ID) {
			await app.client.chat.postMessage({
				channel: config.SUDACCHI_CHANNEL_ID,
				text: "🥚 スダッチが生まれました！",
			});
		}
	}
}
