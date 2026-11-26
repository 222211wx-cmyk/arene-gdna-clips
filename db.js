import pg from 'pg';
import crypto from 'node:crypto';

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
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS v720_key text;
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS v360_key text;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS guest_token text UNIQUE;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS notifications boolean NOT NULL DEFAULT true;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS private_profile boolean NOT NULL DEFAULT false;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS allow_messages boolean NOT NULL DEFAULT true;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr';
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON clips.users (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '';
ALTER TABLE clips.messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE TABLE IF NOT EXISTS clips.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clips.shares (
  id bigserial PRIMARY KEY,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES clips.users(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'link',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_clip_idx ON clips.shares (clip_id);
-- accent- and case-insensitive text for search (no extension needed)
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS city text NOT NULL DEFAULT '';
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS link text NOT NULL DEFAULT '';
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS avatar_key text;
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS prefs jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS clips.support (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES clips.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  message text NOT NULL,
  contact text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clips.users ADD COLUMN IF NOT EXISTS cover_key text;
CREATE TABLE IF NOT EXISTS clips.media (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo','video')),
  key text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_user_idx ON clips.media (user_id, kind, created_at DESC);
CREATE TABLE IF NOT EXISTS clips.favorites (
  user_id uuid NOT NULL REFERENCES clips.users(id) ON DELETE CASCADE,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, clip_id)
);
ALTER TABLE clips.follows ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted';
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS privacy text NOT NULL DEFAULT 'public';
ALTER TABLE clips.media ADD COLUMN IF NOT EXISTS privacy text NOT NULL DEFAULT 'public';
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT true;
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS trim_start real;
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS trim_end real;
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS accessories text NOT NULL DEFAULT '';
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS overlay_text text NOT NULL DEFAULT '';
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS fx_filter text NOT NULL DEFAULT '';
ALTER TABLE clips.clips ADD COLUMN IF NOT EXISTS watermark boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS clips.reports (
  id bigserial PRIMARY KEY,
  clip_id text NOT NULL REFERENCES clips.clips(id) ON DELETE CASCADE,
  user_id uuid REFERENCES clips.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION clips.norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(lower(coalesce(t,'')), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœ', 'aaaaaaceeeeiiiinooooouuuuyyo') $$;
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
  await backfillTags();
}
export const getDefaultUserId = () => defaultUserId;

const COLS = `c.id, c.key, c.poster_key, c.v720_key, c.v360_key, c.title, c.description, c.comment, c.music_id, c.music_name, c.music_artist,
  c.enhancement, c.privacy, c.views, c.allow_download, c.trim_start, c.trim_end, c.accessories, c.overlay_text, c.fx_filter, c.watermark, c.created_at, u.id AS author_id, u.handle, u.display_name, u.avatar_key,
  (SELECT count(*)::int FROM clips.likes l WHERE l.clip_id = c.id) AS likes,
  (SELECT count(*)::int FROM clips.comments m WHERE m.clip_id = c.id) AS comments,
  (SELECT count(*)::int FROM clips.saves s WHERE s.clip_id = c.id) AS saves,
  (SELECT count(*)::int FROM clips.shares h WHERE h.clip_id = c.id) AS shares, c.tags`;

// Plain-text form used for search: lowercase, no accents (mirrors clips.norm in SQL).
export const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/g, 'o').toLowerCase();
export const tagsOf = (...t) => [...new Set((t.join(' ').match(/#[\p{L}\p{N}_]+/gu) || []).map((x) => norm(x.slice(1))))].join(' ');

// Who may see a clip (alias c = clips, u = its author), for the viewer in parameter $n:
// the owner always; a private item never anyone else; a followers-only item only accepted followers; a private profile only accepted followers.
const accepted = (n, owner) => `EXISTS (SELECT 1 FROM clips.follows fv WHERE fv.followee_id = ${owner} AND fv.follower_id = $${n}::uuid AND fv.status = 'accepted')`;
const visible = (n) => `(c.user_id = $${n}::uuid OR (c.privacy <> 'private' AND (NOT u.private_profile OR ${accepted(n, 'c.user_id')}) AND (c.privacy = 'public' OR ${accepted(n, 'c.user_id')})))`;
export async function clipVisible(id, viewerId) {
  const { rows } = await pool.query(`SELECT 1 FROM clips.clips c JOIN clips.users u ON u.id = c.user_id WHERE c.id = $1 AND ${visible(2)}`, [id, viewerId || null]);
  return rows.length > 0;
}
export async function setClipPrivacy(userId, clipId, privacy) {
  const { rowCount } = await pool.query('UPDATE clips.clips SET privacy = $3 WHERE id = $1 AND user_id = $2', [clipId, userId, privacy]);
  return rowCount > 0;
}
// Owner edit: title, description, non-destructive trim (seconds) and emoji accessories (space-separated).
export async function editClip(userId, clipId, f) {
  const sets = [], args = [clipId, userId];
  const add = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  if ('title' in f) add('title', f.title);
  if ('description' in f) add('description', f.description);
  if ('trimStart' in f) add('trim_start', f.trimStart);
  if ('trimEnd' in f) add('trim_end', f.trimEnd);
  if ('accessories' in f) add('accessories', f.accessories);
  if ('overlayText' in f) add('overlay_text', f.overlayText);
  if ('filter' in f) add('fx_filter', f.filter);
  if ('watermark' in f) add('watermark', f.watermark);
  if (!sets.length) return false;
  const { rowCount } = await pool.query(`UPDATE clips.clips SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`, args);
  return rowCount > 0;
}
export async function setClipDownload(userId, clipId, allow) {
  const { rowCount } = await pool.query('UPDATE clips.clips SET allow_download = $3 WHERE id = $1 AND user_id = $2', [clipId, userId, allow]);
  return rowCount > 0;
}
// Owner-only delete: returns the R2 keys to remove, or null when the clip is not the user's.
export async function deleteClip(userId, clipId) {
  const { rows } = await pool.query('DELETE FROM clips.clips WHERE id = $1 AND user_id = $2 RETURNING key, poster_key, v720_key, v360_key', [clipId, userId]);
  return rows[0] ? [rows[0].key, rows[0].poster_key, rows[0].v720_key, rows[0].v360_key].filter(Boolean) : null;
}
// One view per call; the owner watching their own clip does not count.
export async function addView(clipId, userId) {
  const { rows } = await pool.query('UPDATE clips.clips SET views = views + 1 WHERE id = $1 AND user_id IS DISTINCT FROM $2::uuid RETURNING views', [clipId, userId || null]);
  if (rows[0]) return rows[0].views;
  return (await pool.query('SELECT views FROM clips.clips WHERE id = $1', [clipId])).rows[0]?.views ?? 0;
}
export async function addReport(clipId, userId, reason) {
  await pool.query('INSERT INTO clips.reports (clip_id, user_id, reason) VALUES ($1,$2,$3)', [clipId, userId || null, reason]);
}
export async function setMediaPrivacy(userId, id, privacy) {
  const { rowCount } = await pool.query('UPDATE clips.media SET privacy = $3 WHERE id = $1 AND user_id = $2', [id, userId, privacy]);
  return rowCount > 0;
}

// Newest first; keyset pagination on (created_at, id) so pages never overlap or repeat.
// q: every word must appear in title + caption + comment + tags + creator name/handle (accent-insensitive).
export async function feed({ limit = 10, before, q, authorHandle, viewerId } = {}) {
  const args = [Math.min(Math.max(limit, 1), 30) + 1];
  const conds = [];
  if (before) {
    const [ts, id] = before.split('_');
    args.push(ts, id);
    conds.push('(c.created_at, c.id) < ($2::timestamptz, $3::text)');
  }
  if (authorHandle) { args.push(authorHandle); conds.push(`u.handle = $${args.length}`); }
  for (const w of norm(q).split(/\s+/).filter(Boolean).slice(0, 6)) {
    args.push(`%${w.replace(/[\\%_]/g, '\\$&')}%`);
    conds.push(`clips.norm(c.title || ' ' || c.description || ' ' || c.comment || ' ' || c.tags || ' ' || u.handle || ' ' || u.display_name) LIKE $${args.length}`);
  }
  args.push(viewerId || null); conds.push(visible(args.length));
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
    `INSERT INTO clips.clips (id,user_id,key,poster_key,v720_key,v360_key,title,description,comment,music_id,music_name,music_artist,enhancement,created_at,tags, privacy)
     VALUES ($1,$2,$3,$4,$14,$15,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz, now()),$13,$16)
     ON CONFLICT (id) DO UPDATE SET poster_key = COALESCE(EXCLUDED.poster_key, clips.clips.poster_key),
       v720_key = COALESCE(EXCLUDED.v720_key, clips.clips.v720_key), v360_key = COALESCE(EXCLUDED.v360_key, clips.clips.v360_key),
       title = EXCLUDED.title, description = EXCLUDED.description, comment = EXCLUDED.comment,
       music_id = EXCLUDED.music_id, music_name = EXCLUDED.music_name, music_artist = EXCLUDED.music_artist,
       enhancement = EXCLUDED.enhancement, tags = EXCLUDED.tags, privacy = EXCLUDED.privacy`,
    [c.id, c.userId, c.key, c.posterKey || null, c.title, c.description, c.comment, c.musicId, c.musicName, c.musicArtist, JSON.stringify(c.enhancement || {}), c.createdAt || null, tagsOf(c.title, c.description, c.comment), c.v720Key || null, c.v360Key || null, c.privacy || 'public']);
  return clipById(c.id);
}
export async function knownKeys() {
  const { rows } = await pool.query('SELECT key FROM clips.clips');
  return new Set(rows.map((r) => r.key));
}

// ---- accounts: email + password + username, session cookie ----
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hashPw = (pw) => { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`; };
const checkPw = (pw, stored) => {
  const [alg, salt, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const USER_COLS = 'id, handle, display_name, bio, city, link, avatar_key, cover_key, email, notifications, private_profile, allow_messages, language, prefs, created_at';
export async function signup({ email, username, name, password }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO clips.users (handle, display_name, email, password_hash) VALUES ($1,$2,$3,$4) RETURNING ${USER_COLS}`,
      [username, name || username, email, hashPw(password)]);
    return { user: rows[0] };
  } catch (e) {
    if (e.code === '23505') return { error: /email/.test(e.constraint || e.detail || '') ? 'email' : 'username' };
    throw e;
  }
}
// Guest mode: a visitor without an account gets a hidden users row tied to a `gid` cookie, so like/save/comment/message persist.
export async function guestByToken(token) {
  if (!pool || !/^[a-f0-9]{32}$/.test(token || '')) return null;
  const { rows } = await pool.query(`SELECT ${USER_COLS} FROM clips.users WHERE guest_token = $1`, [sha(token)]);
  return rows[0] || null;
}
export async function createGuest() {
  const token = crypto.randomBytes(16).toString('hex'), handle = 'invite-' + crypto.randomBytes(4).toString('hex');
  const { rows } = await pool.query(`INSERT INTO clips.users (handle, display_name, guest_token) VALUES ($1,'Invité',$2) RETURNING ${USER_COLS}`, [handle, sha(token)]);
  return { user: rows[0], token };
}
export async function login(email, password) {
  const { rows } = await pool.query(`SELECT ${USER_COLS}, password_hash FROM clips.users WHERE lower(email) = lower($1)`, [email]);
  const u = rows[0];
  if (!u || !checkPw(password, u.password_hash)) { crypto.scryptSync(password, 'x', 64); return null; }
  delete u.password_hash; return u;
}
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO clips.sessions (token_hash, user_id) VALUES ($1,$2)', [sha(token), userId]);
  return token;
}
export async function userBySession(token) {
  if (!pool || !/^[a-f0-9]{64}$/.test(token || '')) return null;
  const { rows } = await pool.query(`SELECT ${USER_COLS.split(', ').map((c) => 'u.' + c).join(', ')} FROM clips.sessions s JOIN clips.users u ON u.id = s.user_id WHERE s.token_hash = $1`, [sha(token)]);
  return rows[0] || null;
}
export const endSession = (token) => pool.query('DELETE FROM clips.sessions WHERE token_hash = $1', [sha(token || '')]);
export async function updateSettings(userId, s) {
  try {
    const { rows } = await pool.query(
      `UPDATE clips.users SET notifications = COALESCE($2, notifications), private_profile = COALESCE($3, private_profile),
         allow_messages = COALESCE($4, allow_messages), display_name = COALESCE($5, display_name), language = 'fr',
         handle = COALESCE($6, handle), bio = COALESCE($7, bio), city = COALESCE($8, city), link = COALESCE($9, link),
         avatar_key = COALESCE($10, avatar_key), cover_key = COALESCE($11, cover_key),
         prefs = COALESCE(prefs || $12::jsonb, prefs)
       WHERE id = $1 RETURNING ${USER_COLS}`,
      [userId, s.notifications ?? null, s.private_profile ?? null, s.allow_messages ?? null, s.display_name ?? null,
        s.handle ?? null, s.bio ?? null, s.city ?? null, s.link ?? null, s.avatar_key ?? null, s.cover_key ?? null, s.prefs ? JSON.stringify(s.prefs) : null]);
    if (s.private_profile === false) await pool.query("UPDATE clips.follows SET status = 'accepted' WHERE followee_id = $1 AND status = 'pending'", [userId]);
    return { user: rows[0] };
  } catch (e) { if (e.code === '23505') return { error: 'username' }; throw e; }
}
export async function addMedia(userId, kind, key, privacy = 'public') {
  const { rows } = await pool.query('INSERT INTO clips.media (user_id, kind, key, privacy) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING RETURNING id, kind, key, privacy, created_at', [userId, kind, key, privacy]);
  return rows[0];
}
export async function listMedia(userId, kind, viewerId) {
  const own = viewerId === userId;
  const { rows } = await pool.query(`SELECT m.id, m.kind, m.key, m.privacy, m.created_at FROM clips.media m WHERE m.user_id = $1 AND m.kind = $2
    AND ($3::boolean OR m.privacy = 'public' OR (m.privacy = 'followers' AND ${accepted(4, '$1::uuid')})) ORDER BY m.created_at DESC, m.id DESC LIMIT 200`, [userId, kind, own, viewerId || null]);
  return rows;
}
export async function deleteMedia(userId, id) {
  const { rows } = await pool.query('DELETE FROM clips.media WHERE id = $1 AND user_id = $2 RETURNING key', [id, userId]);
  return rows[0]?.key || null;
}
export async function setFavorite(userId, clipId, on) {
  await pool.query(on
    ? 'INSERT INTO clips.favorites (user_id, clip_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
    : 'DELETE FROM clips.favorites WHERE user_id = $1 AND clip_id = $2', [userId, clipId]);
  return { on };
}
// Deletes the account and everything it owns; returns the R2 keys to remove.
export async function passwordOk(userId, password) {
  const { rows } = await pool.query('SELECT password_hash FROM clips.users WHERE id = $1', [userId]);
  return !!rows[0] && checkPw(String(password || ''), rows[0].password_hash);
}
export async function deleteAccount(userId, password) {
  const { rows } = await pool.query('SELECT password_hash FROM clips.users WHERE id = $1', [userId]);
  if (!rows[0] || !checkPw(password, rows[0].password_hash)) return null;
  const k = await pool.query('SELECT key, poster_key, v720_key, v360_key FROM clips.clips WHERE user_id = $1', [userId]);
  const mk = await pool.query('SELECT key FROM clips.media WHERE user_id = $1 UNION SELECT avatar_key FROM clips.users WHERE id = $1 UNION SELECT cover_key FROM clips.users WHERE id = $1', [userId]);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM clips.clips WHERE user_id = $1', [userId]);
    await c.query('DELETE FROM clips.users WHERE id = $1', [userId]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  return k.rows.flatMap((r) => [r.key, r.poster_key, r.v720_key, r.v360_key]).concat(mk.rows.map((r) => r.key)).filter(Boolean);
}
// Per-clip state for one viewer: liked / saved / following the author.
export async function viewerState(userId, ids) {
  const out = {};
  if (!userId || !ids.length) return out;
  const { rows } = await pool.query(
    `SELECT c.id,
       EXISTS (SELECT 1 FROM clips.likes l WHERE l.clip_id = c.id AND l.user_id = $1) AS liked,
       EXISTS (SELECT 1 FROM clips.saves s WHERE s.clip_id = c.id AND s.user_id = $1) AS saved,
       EXISTS (SELECT 1 FROM clips.follows f WHERE f.followee_id = c.user_id AND f.follower_id = $1 AND f.status = 'accepted') AS following,
       (SELECT f.status FROM clips.follows f WHERE f.followee_id = c.user_id AND f.follower_id = $1) AS follow_status,
       EXISTS (SELECT 1 FROM clips.favorites v WHERE v.clip_id = c.id AND v.user_id = $1) AS favorited
     FROM clips.clips c WHERE c.id = ANY($2::text[])`, [userId, ids]);
  rows.forEach((r) => { out[r.id] = { liked: r.liked, saved: r.saved, following: r.following, requested: r.follow_status === 'pending', favorited: r.favorited }; });
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
export async function addShare(userId, clipId, channel) {
  await pool.query('INSERT INTO clips.shares (clip_id, user_id, channel) VALUES ($1,$2,$3)', [clipId, userId || null, channel]);
  return { count: await count('shares', clipId) };
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
// Following a private profile only sends a request (status 'pending') that the owner accepts or declines.
export async function setFollow(userId, authorId, on) {
  if (userId === authorId) return { error: 'self' };
  let status = null;
  if (on) {
    const t = await pool.query('SELECT private_profile FROM clips.users WHERE id = $1', [authorId]);
    status = t.rows[0]?.private_profile ? 'pending' : 'accepted';
    await pool.query("INSERT INTO clips.follows (follower_id, followee_id, status) VALUES ($1,$2,$3) ON CONFLICT (follower_id, followee_id) DO NOTHING", [userId, authorId, status]);
    const cur = await pool.query('SELECT status FROM clips.follows WHERE follower_id = $1 AND followee_id = $2', [userId, authorId]); status = cur.rows[0].status;
  } else await pool.query('DELETE FROM clips.follows WHERE follower_id = $1 AND followee_id = $2', [userId, authorId]);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM clips.follows WHERE followee_id = $1 AND status = 'accepted'", [authorId]);
  return { on, status, followers: rows[0].n };
}
export async function pendingRequests(userId) {
  const { rows } = await pool.query("SELECT u.handle, u.display_name AS name FROM clips.follows f JOIN clips.users u ON u.id = f.follower_id WHERE f.followee_id = $1 AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 100", [userId]);
  return rows;
}
export async function answerRequest(ownerId, handle, accept) {
  const u = await pool.query('SELECT id FROM clips.users WHERE handle = $1', [handle]); if (!u.rows[0]) return false;
  const r = accept
    ? await pool.query("UPDATE clips.follows SET status = 'accepted' WHERE follower_id = $1 AND followee_id = $2 AND status = 'pending'", [u.rows[0].id, ownerId])
    : await pool.query("DELETE FROM clips.follows WHERE follower_id = $1 AND followee_id = $2 AND status = 'pending'", [u.rows[0].id, ownerId]);
  return r.rowCount > 0;
}
export async function citizen(handle, viewerId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.handle, u.display_name, u.bio, u.city, u.link, u.avatar_key, u.cover_key, u.private_profile, u.allow_messages, extract(year FROM u.created_at)::int AS year,
       (SELECT count(*)::int FROM clips.users o WHERE (o.created_at, o.id) <= (u.created_at, u.id)) AS seq,
       (SELECT count(*)::int FROM clips.clips c WHERE c.user_id = u.id) AS clips,
       (SELECT count(*)::int FROM clips.follows f WHERE f.followee_id = u.id AND f.status = 'accepted') AS followers,
       (SELECT count(*)::int FROM clips.follows f WHERE f.follower_id = u.id AND f.status = 'accepted') AS following,
       (SELECT f.status FROM clips.follows f WHERE f.followee_id = u.id AND f.follower_id = $2) AS follow_status
     FROM clips.users u WHERE u.handle = $1`, [handle, viewerId || null]);
  return rows[0] || null;
}
export async function followers(userId) {
  const { rows } = await pool.query(
    `SELECT u.handle, u.display_name AS name FROM clips.follows f JOIN clips.users u ON u.id = f.follower_id WHERE f.followee_id = $1 AND f.status = 'accepted' ORDER BY f.created_at DESC LIMIT 200`, [userId]);
  return rows;
}
export async function setFollowUser(userId, targetId, on) { return setFollow(userId, targetId, on); }
export async function sendMessage(fromId, toId, clipId, body) {
  const { rows } = await pool.query(
    'INSERT INTO clips.messages (from_id, to_id, clip_id, body) VALUES ($1,$2,$3,$4) RETURNING id, body, created_at', [fromId, toId, clipId || null, body]);
  return rows[0];
}
// Thread with one person (marks their messages read), oldest first.
export async function thread(userId, withHandle) {
  const o = await pool.query('SELECT id, handle, display_name AS name, allow_messages FROM clips.users WHERE handle = $1', [withHandle]);
  if (!o.rows[0]) return null;
  await pool.query('UPDATE clips.messages SET read_at = now() WHERE to_id = $1 AND from_id = $2 AND read_at IS NULL', [userId, o.rows[0].id]);
  const { rows } = await pool.query(
    `SELECT m.id, m.body, m.created_at, m.from_id = $1 AS mine FROM clips.messages m
     WHERE (m.from_id = $1 AND m.to_id = $2) OR (m.to_id = $1 AND m.from_id = $2) ORDER BY m.created_at DESC, m.id DESC LIMIT 100`, [userId, o.rows[0].id]);
  return { with: o.rows[0], messages: rows.reverse() };
}
// One row per conversation: last message + unread count.
export async function conversations(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (o.id) o.handle, o.display_name AS name, m.body, m.created_at, m.from_id = $1 AS mine,
       (SELECT count(*)::int FROM clips.messages x WHERE x.to_id = $1 AND x.from_id = o.id AND x.read_at IS NULL) AS unread
     FROM clips.messages m JOIN clips.users o ON o.id = CASE WHEN m.from_id = $1 THEN m.to_id ELSE m.from_id END
     WHERE m.from_id = $1 OR m.to_id = $1 ORDER BY o.id, m.created_at DESC, m.id DESC`, [userId]);
  return rows.sort((a, b) => b.created_at - a.created_at);
}
export async function unreadCount(userId) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM clips.messages WHERE to_id = $1 AND read_at IS NULL', [userId]);
  return rows[0].n;
}
export async function savedClips(userId) {
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM clips.saves sv JOIN clips.clips c ON c.id = sv.clip_id JOIN clips.users u ON u.id = c.user_id
     WHERE sv.user_id = $1 AND ${visible(1)} ORDER BY sv.created_at DESC LIMIT 60`, [userId]);
  return rows;
}
export async function backfillTags() {
  const { rows } = await pool.query("SELECT id, title, description, comment FROM clips.clips WHERE tags = ''");
  for (const r of rows) { const t = tagsOf(r.title, r.description, r.comment); if (t) await pool.query('UPDATE clips.clips SET tags = $2 WHERE id = $1', [r.id, t]); }
}

// ---- settings extras: password, per-owner permissions, notification feed, support messages ----
export async function changePassword(userId, current, next) {
  if (!(await passwordOk(userId, current))) return false;
  await pool.query('UPDATE clips.users SET password_hash = $2 WHERE id = $1', [userId, hashPw(next)]);
  return true;
}
// owner's preferences for a clip: who may comment, who may download
export async function ownerPrefs(clipId) {
  const { rows } = await pool.query('SELECT u.id, u.prefs FROM clips.clips c JOIN clips.users u ON u.id = c.user_id WHERE c.id = $1', [clipId]);
  return rows[0] || null;
}
export async function isFollowerOf(userId, authorId) {
  const { rows } = await pool.query("SELECT 1 FROM clips.follows WHERE follower_id = $1 AND followee_id = $2 AND status = 'accepted'", [userId, authorId]);
  return rows.length > 0;
}
// recent events for one user, by type; `since` marks what is new
export async function notificationFeed(userId, types, since) {
  const parts = [], args = [userId];
  if (types.like) parts.push(`SELECT 'like' AS type, u.display_name AS who, u.handle, c.id AS clip_id, c.title AS detail, l.created_at AS at FROM clips.likes l JOIN clips.clips c ON c.id = l.clip_id JOIN clips.users u ON u.id = l.user_id WHERE c.user_id = $1 AND l.user_id <> $1`);
  if (types.comment) parts.push(`SELECT 'comment' AS type, u.display_name AS who, u.handle, c.id AS clip_id, m.body AS detail, m.created_at AS at FROM clips.comments m JOIN clips.clips c ON c.id = m.clip_id JOIN clips.users u ON u.id = m.user_id WHERE c.user_id = $1 AND m.user_id <> $1`);
  if (types.follow) parts.push(`SELECT 'follow' AS type, u.display_name AS who, u.handle, NULL::text AS clip_id, ''::text AS detail, f.created_at AS at FROM clips.follows f JOIN clips.users u ON u.id = f.follower_id WHERE f.followee_id = $1 AND f.status = 'accepted'`);
  if (types.clip) parts.push(`SELECT 'clip' AS type, u.display_name AS who, u.handle, c.id AS clip_id, c.title AS detail, c.created_at AS at FROM clips.clips c JOIN clips.users u ON u.id = c.user_id JOIN clips.follows f ON f.followee_id = c.user_id AND f.follower_id = $1 AND f.status = 'accepted' WHERE c.privacy = 'public'`);
  if (!parts.length) return { items: [], fresh: 0 };
  const { rows } = await pool.query(`SELECT * FROM (${parts.join(' UNION ALL ')}) e ORDER BY at DESC LIMIT 40`, args);
  const t = since ? new Date(since).getTime() : 0;
  return { items: rows.map((r) => ({ type: r.type, who: r.who, handle: r.handle, clip: r.clip_id, detail: r.detail, at: r.at })), fresh: rows.filter((r) => new Date(r.at).getTime() > t).length };
}
export const addSupport = (userId, kind, message, contact) => pool.query('INSERT INTO clips.support (user_id, kind, message, contact) VALUES ($1,$2,$3,$4)', [userId, kind, message, contact]);
