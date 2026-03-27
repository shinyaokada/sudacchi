import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sudacchi = sqliteTable("sudacchi", {
	id: text("id").primaryKey(),
	name: text("name").notNull().default("スダッチ"),
	stage: text("stage", { enum: ["egg", "baby", "child", "adult", "veteran"] })
		.notNull()
		.default("egg"),
	hunger: real("hunger").notNull().default(50),
	mood: real("mood").notNull().default(50),
	energy: real("energy").notNull().default(50),
	isSleeping: integer("is_sleeping", { mode: "boolean" }).notNull().default(false),
	bornAt: integer("born_at", { mode: "timestamp" }).notNull(),
	diedAt: integer("died_at", { mode: "timestamp" }),
	lastFedAt: integer("last_fed_at", { mode: "timestamp" }),
	lastPlayedAt: integer("last_played_at", { mode: "timestamp" }),
	lastSleptAt: integer("last_slept_at", { mode: "timestamp" }),
	lastInteractionAt: integer("last_interaction_at", { mode: "timestamp" }),
	hungerZeroSince: integer("hunger_zero_since", { mode: "timestamp" }),
	moodZeroSince: integer("mood_zero_since", { mode: "timestamp" }),
	allLowSince: integer("all_low_since", { mode: "timestamp" }),
});

export const userBonds = sqliteTable("user_bonds", {
	userId: text("user_id").notNull(),
	sudacchiId: text("sudacchi_id")
		.notNull()
		.references(() => sudacchi.id),
	bond: integer("bond").notNull().default(0),
	totalFeeds: integer("total_feeds").notNull().default(0),
	totalPlays: integer("total_plays").notNull().default(0),
	totalPets: integer("total_pets").notNull().default(0),
	lastInteractionAt: integer("last_interaction_at", { mode: "timestamp" }),
});

export const interactionLogs = sqliteTable("interaction_logs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	sudacchiId: text("sudacchi_id")
		.notNull()
		.references(() => sudacchi.id),
	userId: text("user_id"),
	type: text("type", { enum: ["feed", "play", "pet", "sleep", "wake", "talk", "event"] }).notNull(),
	detail: text("detail"),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const memories = sqliteTable("memories", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	sudacchiId: text("sudacchi_id")
		.notNull()
		.references(() => sudacchi.id),
	userId: text("user_id"),
	type: text("type", { enum: ["short_term", "long_term"] }).notNull(),
	content: text("content").notNull(),
	importance: integer("importance").notNull().default(0),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp" }),
});
