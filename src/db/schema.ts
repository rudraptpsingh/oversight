import fs from "fs"
import path from "path"
import { openDatabase, type Database } from "./adapter.js"

export type { Database }

export async function initDb(oversightDir: string): Promise<Database> {
  fs.mkdirSync(oversightDir, { recursive: true })
  const dbPath = path.join(oversightDir, "decisions.db")
  const db = await openDatabase(dbPath)

  db.exec(`
    CREATE TABLE IF NOT EXISTS check_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      change_description TEXT NOT NULL,
      affected_paths_json TEXT NOT NULL DEFAULT '[]',
      relevant_decision_ids_json TEXT NOT NULL DEFAULT '[]',
      must_constraint_count INTEGER NOT NULL DEFAULT 0,
      should_constraint_count INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL,
      warning_count INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      anchors_json TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      constraints_json TEXT NOT NULL DEFAULT '[]',
      alternatives_json TEXT NOT NULL DEFAULT '[]',
      consequences TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      decision_type TEXT NOT NULL DEFAULT 'architectural',
      confidence TEXT NOT NULL DEFAULT 'provisional',
      author TEXT NOT NULL DEFAULT '',
      timestamp TEXT NOT NULL,
      linked_pr TEXT,
      linked_issue TEXT,
      supersedes_json TEXT NOT NULL DEFAULT '[]',
      superseded_by TEXT,
      agent_hints_json TEXT NOT NULL DEFAULT '[]',
      do_not_change_json TEXT NOT NULL DEFAULT '[]',
      review_triggers_json TEXT NOT NULL DEFAULT '[]',
      source_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL DEFAULT '',
      task_description TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      decisions_recorded_json TEXT NOT NULL DEFAULT '[]',
      checks_performed INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      handoff_notes TEXT NOT NULL DEFAULT ''
    );
  `)

  return db
}

export async function getDb(oversightDir: string): Promise<Database> {
  const dbPath = path.join(oversightDir, "decisions.db")
  return openDatabase(dbPath)
}
