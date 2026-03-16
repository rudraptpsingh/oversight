import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): void
  pragma(str: string): void
  close(): void
}

type SqlJsDatabase = import("sql.js").Database
type SqlJsStatic = import("sql.js").SqlJsStatic

let _SQL: SqlJsStatic | null = null

async function getSqlJs(): Promise<SqlJsStatic> {
  if (_SQL) return _SQL
  const initSqlJs = require("sql.js/dist/sql-asm.js") as (config?: unknown) => Promise<SqlJsStatic>
  _SQL = await initSqlJs()
  return _SQL
}

function toPositional(sql: string, named: Record<string, unknown>): [string, unknown[]] {
  const params: unknown[] = []
  const converted = sql.replace(/@(\w+)/g, (_match, key) => {
    params.push(named[key] ?? null)
    return "?"
  })
  return [converted, params]
}

function normalizeArgs(sql: string, args: unknown[]): [string, unknown[]] {
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0])
  ) {
    return toPositional(sql, args[0] as Record<string, unknown>)
  }
  return [sql, args.map(v => v ?? null)]
}

function makeStatement(sqlDb: SqlJsDatabase, sql: string, persist: () => void): Statement {
  const normalized = sql.trim().toUpperCase()
  const isWrite =
    normalized.startsWith("INSERT") ||
    normalized.startsWith("UPDATE") ||
    normalized.startsWith("DELETE") ||
    normalized.startsWith("REPLACE")

  return {
    run(...args: unknown[]): RunResult {
      const [finalSql, params] = normalizeArgs(sql, args)
      sqlDb.run(finalSql, params as (string | number | null | Uint8Array)[])
      const changes = sqlDb.getRowsModified()
      if (isWrite) persist()
      return { changes, lastInsertRowid: 0 }
    },

    get(...args: unknown[]): unknown {
      const [finalSql, params] = normalizeArgs(sql, args)
      const stmt = sqlDb.prepare(finalSql)
      stmt.bind(params as (string | number | null | Uint8Array)[])
      const hasRow = stmt.step()
      if (!hasRow) {
        stmt.free()
        return undefined
      }
      const cols = stmt.getColumnNames()
      const vals = stmt.get() as unknown[]
      stmt.free()
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < cols.length; i++) {
        obj[cols[i]] = vals[i]
      }
      return obj
    },

    all(...args: unknown[]): unknown[] {
      const [finalSql, params] = normalizeArgs(sql, args)
      const stmt = sqlDb.prepare(finalSql)
      if (params.length > 0) {
        stmt.bind(params as (string | number | null | Uint8Array)[])
      }
      const cols = stmt.getColumnNames()
      const rows: Record<string, unknown>[] = []
      while (stmt.step()) {
        const vals = stmt.get() as unknown[]
        const obj: Record<string, unknown> = {}
        for (let i = 0; i < cols.length; i++) {
          obj[cols[i]] = vals[i]
        }
        rows.push(obj)
      }
      stmt.free()
      return rows
    },
  }
}

function wrapSqlJs(sqlDb: SqlJsDatabase, dbPath: string): Database {
  function persist() {
    try {
      const data = sqlDb.export()
      const dir = path.dirname(dbPath)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(dbPath, Buffer.from(data))
    } catch {
    }
  }

  return {
    prepare(sql: string): Statement {
      return makeStatement(sqlDb, sql, persist)
    },

    exec(sql: string): void {
      sqlDb.run(sql)
      persist()
    },

    pragma(_str: string): void {
    },

    close(): void {
      persist()
      sqlDb.close()
    },
  }
}

export async function openDatabase(dbPath: string): Promise<Database> {
  const SQL = await getSqlJs()
  let sqlDb: SqlJsDatabase
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    sqlDb = new SQL.Database(fileBuffer)
  } else {
    sqlDb = new SQL.Database()
  }
  return wrapSqlJs(sqlDb, dbPath)
}
