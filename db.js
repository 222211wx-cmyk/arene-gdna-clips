import pg from 'pg';

// Dedicated schema so this app never collides with tables of the main GDNA Arena app in the same Postgres.
const url = process.env.DATABASE_URL || '';
export const dbConfigured = !!url;
const local = /localhost|127\.0\.0\.1|\.railway\.internal/.test(url);
export const pool = dbConfigured ? new pg.Pool({
  connectionString: url, max: 10,
  ssl: local ? false : { rejectUnauthorized: false },
  options: '-c search_path=clips,public',
}) : null;

const SCHEMA = `
CREATE SCHEMA IF NOT EXISTS clips;
CREATE TABLE IF NOT EXISTS clips.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle text UNIQUE NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clips.clips (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES clips.users(id),
  key text UNIQUE NOT NULL,
  poster_key text,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  comment text NOT NULL DEFAULT '',
  music_id text,
  music_name text,
  music_artist text,
  enhancement jsonb NOT NULL DEFAULT '{}',
  views integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clips_created_idx ON clips.clips (created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS clips.likes (
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clip_id)
);
CREATE TABLE IF NOT EXISTS clips.comments (
  id bigserial PRIMARY KEY,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_clip_idx ON clips.comments (clip_id, created_at);
CREATE TABLE IF NOT EXISTS clips.follows (
  follower_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE TABLE IF NOT EXISTS clips.saves (
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clip_id)
);
CREATE TABLE IF NOT EXISTS clips.messages (
  id bigserial PRIMARY KEY,
  from_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  to_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  clip_id text REFERENCES clips.clips(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_to_idx ON clips.messages (to_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_from_idx ON clips.messages (from_id, created_at DESC);
`;

export const DEFAULT_USER = { handle: 'qaisypro', display_name: 'El Qaisy Abdelmalik' };
let defaultUserId = null;

export async function migrate() {
  if (!pool) return;
  await pool.query(SCHEMA);
  const r = await pool.query(
    `INSERT INTO clips.users (handle, display_name) VALUES ($1,$2)
     ON CONFLICT (handle) DO UPDATE SET display_name = clips.users.display_name RETURNING id`,
    [DEFAULT_USER.handle, DEFAULT_USER.display_name]);
  defaultUserId = r.rows[0].id;
}
export const getDefaultUserId = () => defaultUserId;

const COLS = `c.id, c.key, c.poster_key, c.title, c.description, c.comment, c.music_id, c.music_name, c.music_artist,
  c.enhancement, c.views, c.created_at, u.id AS author_id, u.handle, u.display_name,
  (SELECT count(*)::int FROM clips.likes l WHERE l.clip_id = c.id) AS likes,
  (SELECT count(*)::int FROM clips.comments m WHERE m.clip_id = c.id) AS comments,
  (SELECT count(*)::int FROM clips.saves s WHERE s.clip_id = c.id) AS saves`;

// Newest first; keyset pagination on (created_at, id) so pages never overlap or repeat.
export async function feed({ limit = 10, before, q } = {}) {
  const args = [Math.min(Math.max(limit, 1), 30) + 1];
  const conds = [];
  if (before) {
    const [ts, id] = before.split('_');
    args.push(ts, id);
    conds.push('(c.created_at, c.id) < ($2::timestamptz, $3::text)');
  }
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    conds.push(`(c.title ILIKE $${args.length} OR c.description ILIKE $${args.length} OR c.comment ILIKE $${args.length} OR u.display_name ILIKE $${args.length} OR u.handle ILIKE $${args.length})`);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM clips.clips c JOIN clips.users u ON u.id = c.user_id ${where}
     ORDER BY c.created_at DESC, c.id DESC LIMIT $1`, args);
  const more = rows.length === args[0];
  if (more) rows.pop();
  const last = rows[rows.length - 1];
  return { rows, next: more && last ? `${last.created_at.toISOString()}_${last.id}` : null };
}
export async function clipById(id) {
  const { rows } = await pool.query(`SELECT ${COLS} FROM clips.clips c JOIN clips.users u ON u.id = c.user_id WHERE c.id = $1`, [id]);
  return rows[0] || null;
}
export async function upsertClip(c) {
  await pool.query(
    `INSERT INTO clips.clips (id,user_id,key,poster_key,title,description,comment,music_id,music_name,music_artist,enhancement,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()))
     ON CONFLICT (id) DO UPDATE SET poster_key = COALESCE(EXCLUDED.poster_key, clips.clips.poster_key),
       title = EXCLUDED.title, description = EXCLUDED.description, comment = EXCLUDED.comment,
       music_id = EXCLUDED.music_id, music_name = EXCLUDED.music_name, music_artist = EXCLUDED.music_artist,
       enhancement = EXCLUDED.enhancement`,
    [c.id, c.userId, c.key, c.posterKey || null, c.title, c.description, c.comment, c.musicId, c.musicName, c.musicArtist, JSON.stringify(c.enhancement || {}), c.createdAt || null]);
  return clipById(c.id);
}
export async function knownKeys() {
  const { rows } = await pool.query('SELECT key FROM clips.clips');
  return new Set(rows.map((r) => r.key));
}

// ---- viewer identity: an anonymous visitor row, keyed by a random cookie token (no login in this app yet) ----
export async function viewerByToken(token) {
  if (!pool || !/^[a-f0-9]{24}$/.test(token || '')) return null;
  const { rows } = await pool.query('SELECT id FROM clips.users WHERE handle = $1', [`v_${token}`]);
  return rows[0]?.id || null;
}
export async function ensureViewer(token) {
  const { rows } = await pool.query(
    `INSERT INTO clips.users (handle, display_name) VALUES ($1, 'Visiteur')
     ON CONFLICT (handle) DO UPDATE SET handle = EXCLUDED.handle RETURNING id`, [`v_${token}`]);
  return rows[0].id;
}
// Per-clip state for one viewer: liked / saved / following the author.
export async function viewerState(userId, ids) {
  const out = {};
  if (!userId || !ids.length) return out;
  const { rows } = await pool.query(
    `SELECT c.id,
       EXISTS (SELECT 1 FROM clips.likes l WHERE l.clip_id = c.id AND l.user_id = $1) AS liked,
       EXISTS (SELECT 1 FROM clips.saves s WHERE s.clip_id = c.id AND s.user_id = $1) AS saved,
       EXISTS (SELECT 1 FROM clips.follows f WHERE f.followee_id = c.user_id AND f.follower_id = $1) AS following
     FROM clips.clips c WHERE c.id = ANY($2::text[])`, [userId, ids]);
  rows.forEach((r) => { out[r.id] = { liked: r.liked, saved: r.saved, following: r.following }; });
  return out;
}
const count = async (table, clipId) => (await pool.query(`SELECT count(*)::int AS n FROM clips.${table} WHERE clip_id = $1`, [clipId])).rows[0].n;
export async function setLike(userId, clipId, on) {
  await pool.query(on
    ? 'INSERT INTO clips.likes (user_id, clip_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
    : 'DELETE FROM clips.likes WHERE user_id = $1 AND clip_id = $2', [userId, clipId]);
  return { on, count: await count('likes', clipId) };
}
export async function setSave(userId, clipId, on) {
  await pool.query(on
    ? 'INSERT INTO clips.saves (user_id, clip_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
    : 'DELETE FROM clips.saves WHERE user_id = $1 AND clip_id = $2', [userId, clipId]);
  return { on, count: await count('saves', clipId) };
}
export async function listComments(clipId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.body, m.created_at, u.display_name AS name FROM clips.comments m JOIN clips.users u ON u.id = m.user_id
     WHERE m.clip_id = $1 ORDER BY m.created_at ASC, m.id ASC LIMIT 200`, [clipId]);
  return rows;
}
export async function addComment(userId, clipId, body) {
  const { rows } = await pool.query(
    `INSERT INTO clips.comments (clip_id, user_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at`, [clipId, userId, body]);
  return { ...rows[0], name: 'Moi', count: await count('comments', clipId) };
}
export async function setFollow(userId, authorId, on) {
  if (userId === authorId) return { error: 'self' };
  await pool.query(on
    ? 'INSERT INTO clips.follows (follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
    : 'DELETE FROM clips.follows WHERE follower_id = $1 AND followee_id = $2', [userId, authorId]);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM clips.follows WHERE followee_id = $1', [authorId]);
  return { on, followers: rows[0].n };
}
export async function citizen(handle, viewerId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.handle, u.display_name,
       (SELECT count(*)::int FROM clips.clips c WHERE c.user_id = u.id) AS clips,
       (SELECT count(*)::int FROM clips.follows f WHERE f.followee_id = u.id) AS followers,
       EXISTS (SELECT 1 FROM clips.follows f WHERE f.followee_id = u.id AND f.follower_id = $2) AS following
     FROM clips.users u WHERE u.handle = $1`, [handle, viewerId]);
  return rows[0] || null;
}
export async function sendMessage(fromId, toId, clipId, body) {
  const { rows } = await pool.query(
    'INSERT INTO clips.messages (from_id, to_id, clip_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at', [fromId, toId, clipId || null, body]);
  return rows[0];
}
export async function inbox(userId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.body, m.created_at, m.from_id = $1 AS mine, m.clip_id,
       CASE WHEN m.from_id = $1 THEN t.display_name ELSE f.display_name END AS other
     FROM clips.messages m JOIN clips.users f ON f.id = m.from_id JOIN clips.users t ON t.id = m.to_id
     WHERE m.from_id = $1 OR m.to_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT 100`, [userId]);
  return rows;
}
export async function savedClips(userId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM clips.saves sv JOIN clips.clips c ON c.id = sv.clip_id JOIN clips.users u ON u.id = c.user_id
     WHERE sv.user_id = $1 ORDER BY sv.created_at DESC LIMIT 60`, [userId]);
  return rows;
}
