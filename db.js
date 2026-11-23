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
  c.enhancement, c.views, c.created_at, u.handle, u.display_name,
  (SELECT count(*)::int FROM clips.likes l WHERE l.clip_id = c.id) AS likes,
  (SELECT count(*)::int FROM clips.comments m WHERE m.clip_id = c.id) AS comments`;

// Newest first; keyset pagination on (created_at, id) so pages never overlap or repeat.
export async function feed({ limit = 10, before } = {}) {
  const args = [Math.min(Math.max(limit, 1), 30) + 1];
  let where = '';
  if (before) {
    const [ts, id] = before.split('_');
    args.push(ts, id);
    where = 'WHERE (c.created_at, c.id) < ($2::timestamptz, $3::text)';
  }
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
