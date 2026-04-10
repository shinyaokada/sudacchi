import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { db } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { createSudacchi, getAliveSudacchi } from "./db/repository/sudacchi.js";
import { handleMessage } from "./core/handler.js";
import { executeTick } from "./scheduler/tick.js";
import { executeDeathCheck } from "./scheduler/death-check.js";
import { applyStatusChange, formatStatusBar } from "./engine/status.js";
import { classifyReaction, getReactionDelta, shortcodeToEmoji } from "./engine/reaction.js";
import { getOrCreateBond, updateBond } from "./db/repository/bond.js";
import { createLog } from "./db/repository/log.js";
import { updateSudacchi } from "./db/repository/sudacchi.js";
import { buildFeedContext, buildSystemPrompt } from "./ai/prompt.js";
import { generateResponse } from "./ai/client.js";

const CLI_USER_ID = "cli-user";
const TICK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Initialize
runMigrations(db);

function getOrCreateSudacchi() {
	const existing = getAliveSudacchi(db);
	if (existing) return existing;

	const id = randomUUID();
	const now = new Date();
	const created = createSudacchi(db, id, now);
	console.log("\n🥚 スダッチが生まれました！\n");
	return created;
}

function printStatus(sudacchi: ReturnType<typeof getAliveSudacchi>) {
	if (!sudacchi) return;
	console.log(
		formatStatusBar({
			id: sudacchi.id,
			name: sudacchi.name,
			stage: sudacchi.stage,
			hunger: sudacchi.hunger,
			mood: sudacchi.mood,
			energy: sudacchi.energy,
			isSleeping: sudacchi.isSleeping,
			bornAt: sudacchi.bornAt,
			diedAt: sudacchi.diedAt,
			lastFedAt: sudacchi.lastFedAt,
			lastPlayedAt: sudacchi.lastPlayedAt,
			lastSleptAt: sudacchi.lastSleptAt,
			lastInteractionAt: sudacchi.lastInteractionAt,
			hungerZeroSince: sudacchi.hungerZeroSince,
			moodZeroSince: sudacchi.moodZeroSince,
			allLowSince: sudacchi.allLowSince,
		}),
	);
}

type SudacchiRow = NonNullable<ReturnType<typeof getAliveSudacchi>>;

async function main() {
	let sudacchi: SudacchiRow = getOrCreateSudacchi();

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	// Periodic tick
	const tickTimer = setInterval(() => {
		const result = executeTick(db, 10);
		if (result) {
			const death = executeDeathCheck(db);
			if (death.isDead) {
				console.log(`\n💀 ${death.reason}`);
				console.log("スダッチは旅立ってしまいました...\n");
				console.log('/reset で新しいスダッチを孵化させられます\n');
			}
		}
	}, TICK_INTERVAL_MS);

	let isClosed = false;
	rl.on("close", () => { isClosed = true; });
	const prompt = () => {
		if (isClosed) return;
		rl.question("> ", handleInput);
	};

	async function handleInput(line: string) {
		const trimmed = line.trim();
		if (!trimmed) {
			prompt();
			return;
		}

		// Special commands
		if (trimmed === "/quit" || trimmed === "/exit") {
			console.log("バイバイ！👋");
			clearInterval(tickTimer);
			rl.close();
			process.exit(0);
		}

		if (trimmed === "/status") {
			sudacchi = getAliveSudacchi(db)!;
			if (!sudacchi) {
				console.log("スダッチはいません。/reset で孵化させましょう。\n");
			} else {
				printStatus(sudacchi);
				console.log();
			}
			prompt();
			return;
		}

		if (trimmed.startsWith("/tick")) {
			const minutes = Number.parseInt(trimmed.split(" ")[1] ?? "10", 10);
			const result = executeTick(db, minutes);
			if (result) {
				console.log(`⏰ ${minutes}分経過しました`);
				const death = executeDeathCheck(db);
				if (death.isDead) {
					console.log(`\n💀 ${death.reason}`);
					console.log("スダッチは旅立ってしまいました...\n");
					console.log('/reset で新しいスダッチを孵化させられます\n');
				} else {
					sudacchi = getAliveSudacchi(db)!;
					printStatus(sudacchi);
					console.log();
				}
			} else {
				console.log("生きているスダッチがいません。\n");
			}
			prompt();
			return;
		}

		if (trimmed === "/reset") {
			const id = randomUUID();
			const now = new Date();
			createSudacchi(db, id, now);
			sudacchi = getAliveSudacchi(db)!;
			console.log("\n🥚 新しいスダッチが生まれました！\n");
			prompt();
			return;
		}

		// Reaction command: <r>:shortcode:
		const reactionMatch = trimmed.match(/^<r>:(.+):$/);
		if (reactionMatch) {
			if (!sudacchi || sudacchi.diedAt) {
				sudacchi = getAliveSudacchi(db)!;
				if (!sudacchi) {
					console.log("スダッチはいません。/reset で孵化させましょう。\n");
					prompt();
					return;
				}
			}

			if (sudacchi.isSleeping) {
				console.log("💤 スダッチは寝ています…zzZ\n");
				prompt();
				return;
			}

			const shortcode = reactionMatch[1];
			const category = classifyReaction(shortcode);
			const reactionResult = getReactionDelta(category, shortcode);

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

			if (state.hunger > 0) state = { ...state, hungerZeroSince: null };
			if (state.mood > 0) state = { ...state, moodZeroSince: null };
			const allOk = state.hunger > 20 || state.mood > 20 || state.energy > 20;
			if (allOk) state = { ...state, allLowSince: null };

			const bond = getOrCreateBond(db, CLI_USER_ID, sudacchi.id);
			const systemPrompt = buildSystemPrompt(state, bond);

			const emoji = shortcodeToEmoji(shortcode) ?? `:${shortcode}:`;
			let userContent: string;
			if (reactionResult.actionType === "feed") {
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

				console.log(`[リアクション: ${emoji}] (${category})`);
				console.log(`スダッチ: ${response}`);
				if (statusBar) {
					console.log(statusBar.split("\n").map((l) => `        ${l}`).join("\n"));
				}
				console.log();

				const nowDate = new Date();
				updateSudacchi(db, sudacchi.id, {
					hunger: state.hunger, mood: state.mood, energy: state.energy,
					isSleeping: state.isSleeping, lastInteractionAt: nowDate,
					...(reactionResult.actionType === "feed" ? { lastFedAt: nowDate } : {}),
					...(reactionResult.actionType === "play" ? { lastPlayedAt: nowDate } : {}),
					hungerZeroSince: state.hungerZeroSince,
					moodZeroSince: state.moodZeroSince,
					allLowSince: state.allLowSince,
				});

				updateBond(db, CLI_USER_ID, sudacchi.id, {
					bond: Math.min(100, bond.bond + (reactionResult.actionType === "talk" ? 1 : 2)),
					lastInteractionAt: nowDate,
					...(reactionResult.actionType === "feed" ? { totalFeeds: bond.totalFeeds + 1 } : {}),
					...(reactionResult.actionType === "play" ? { totalPlays: bond.totalPlays + 1 } : {}),
					...(reactionResult.actionType === "pet" ? { totalPets: bond.totalPets + 1 } : {}),
				});

				createLog(db, {
					sudacchiId: sudacchi.id, userId: CLI_USER_ID,
					type: reactionResult.actionType,
					detail: JSON.stringify({ reaction: shortcode, emoji, response }),
					createdAt: nowDate,
				});

				sudacchi = getAliveSudacchi(db)!;
			} catch (err) {
				console.error("エラーが発生しました:", (err as Error).message);
				console.log();
			}

			prompt();
			return;
		}

		// Normal message
		if (!sudacchi || sudacchi.diedAt) {
			sudacchi = getAliveSudacchi(db)!;
			if (!sudacchi) {
				console.log("スダッチはいません。/reset で孵化させましょう。\n");
				prompt();
				return;
			}
		}

		try {
			const result = await handleMessage(db, {
				userId: CLI_USER_ID,
				message: trimmed,
				sudacchiId: sudacchi.id,
			});

			console.log(`スダッチ: ${result.response}`);
			if (result.statusBar) {
				console.log(result.statusBar.split("\n").map((l) => `        ${l}`).join("\n"));
			}
			console.log();

			// Refresh state
			sudacchi = getAliveSudacchi(db)!;
		} catch (err) {
			console.error("エラーが発生しました:", (err as Error).message);
			console.log();
		}

		prompt();
	}

	prompt();
}

main().catch(console.error);
