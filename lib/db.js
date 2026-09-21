import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('data'); mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'history.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS generations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL, negative TEXT NOT NULL DEFAULT '', model TEXT NOT NULL,
 params TEXT NOT NULL, seed INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL,
 prompt_id TEXT, images TEXT NOT NULL DEFAULT '[]', error TEXT
)`);
const insert = db.prepare('INSERT INTO generations (prompt,negative,model,params,seed,status,prompt_id) VALUES (?,?,?,?,?,?,?)');
export function createGeneration(p) { const result = insert.run(p.prompt, p.negative, p.model, JSON.stringify(p.params), p.params.seed, 'queued', p.promptId); return result.lastInsertRowid; }
export function setPromptId(id, promptId) { db.prepare('UPDATE generations SET prompt_id=? WHERE id=?').run(promptId, id); }
export function updateGeneration(id, status, images = [], error = null) { db.prepare('UPDATE generations SET status=?, images=?, error=? WHERE id=?').run(status, JSON.stringify(images), error, id); }
function map(row) { if (!row) return null; return { ...row, params: JSON.parse(row.params), images: JSON.parse(row.images), image: JSON.parse(row.images)[0] ?? null }; }
export function getGeneration(id) { return map(db.prepare('SELECT * FROM generations WHERE id=?').get(id)); }
export function listGenerations({ limit = 100, offset = 0, model = '', status = '', search = '', sort = 'newest' } = {}) {
  const clauses = [];
  const values = [];
  if (model) { clauses.push('model = ?'); values.push(model); }
  if (status) { clauses.push('status = ?'); values.push(status); }
  if (search) { const escapedSearch = search.replace(/[!%_]/g, character => `!${character}`); clauses.push("(prompt LIKE ? ESCAPE '!' OR negative LIKE ? ESCAPE '!')"); values.push(`%${escapedSearch}%`, `%${escapedSearch}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sort === 'oldest' ? 'ASC' : 'DESC';
  const items = db.prepare(`SELECT * FROM generations ${where} ORDER BY created_at ${order}, id ${order} LIMIT ? OFFSET ?`).all(...values, limit, offset).map(map);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM generations ${where}`).get(...values).count;
  return { items, total, limit, offset, hasNext: offset + items.length < total, hasPrevious: offset > 0 };
}
