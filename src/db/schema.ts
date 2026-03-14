import Database from "better-sqlite3"
import path from "path"
import fs from "fs"

export function initDb(whycodeDir: string): Database.Database {
  fs.mkdirSync(whycodeDir, { recursive: true })
  const dbPath = path.join(whycodeDir, "decisions.db")
  const db = new Database(dbPath)

  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")

  db.exec(`
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
      review_triggers_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS decisions_fts USING fts5(
      decision_id,
      title,
      summary,
      context,
      decision_text,
      rationale,
      tags_text,
      tokenize='porter ascii'
    );
  `)

  return db
}

export function getDb(whycodeDir: string): Database.Database {
  const dbPath = path.join(whycodeDir, "decisions.db")
  const db = new Database(dbPath)
  db.pragma("journal_mode = WAL")
  db.pragma("foreign_keys = ON")
  return db
}
