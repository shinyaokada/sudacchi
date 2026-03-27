import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import * as schema from "./schema.js";

export function runMigrations(db: Db) {
	db.run(sql`CREATE TABLE IF NOT EXISTS sudacchi (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT 'スダッチ',
		stage TEXT NOT NULL DEFAULT 'egg',
		hunger REAL NOT NULL DEFAULT 50,
		mood REAL NOT NULL DEFAULT 50,
		energy REAL NOT NULL DEFAULT 50,
		is_sleeping INTEGER NOT NULL DEFAULT 0,
		born_at INTEGER NOT NULL,
		died_at INTEGER,
		last_fed_at INTEGER,
		last_played_at INTEGER,
		last_slept_at INTEGER,
		last_interaction_at INTEGER,
		hunger_zero_since INTEGER,
		mood_zero_since INTEGER,
		all_low_since INTEGER
	)`);

	db.run(sql`CREATE TABLE IF NOT EXISTS user_bonds (
		user_id TEXT NOT NULL,
		sudacchi_id TEXT NOT NULL REFERENCES sudacchi(id),
		bond INTEGER NOT NULL DEFAULT 0,
		total_feeds INTEGER NOT NULL DEFAULT 0,
		total_plays INTEGER NOT NULL DEFAULT 0,
		total_pets INTEGER NOT NULL DEFAULT 0,
		last_interaction_at INTEGER,
		PRIMARY KEY (user_id, sudacchi_id)
	)`);

	db.run(sql`CREATE TABLE IF NOT EXISTS interaction_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sudacchi_id TEXT NOT NULL REFERENCES sudacchi(id),
		user_id TEXT,
		type TEXT NOT NULL,
		detail TEXT,
		created_at INTEGER NOT NULL
	)`);

	db.run(sql`CREATE TABLE IF NOT EXISTS memories (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		sudacchi_id TEXT NOT NULL REFERENCES sudacchi(id),
		user_id TEXT,
		type TEXT NOT NULL,
		content TEXT NOT NULL,
		importance INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		expires_at INTEGER
	)`);
}
