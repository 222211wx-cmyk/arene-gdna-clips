// Playlist catalog. Audio: SoundHelix example tracks (free to use), proxied by the server for mixing.
const SRC = (n) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;
const T = (id, name, artist, mood, tags, n, hue) => ({ id, name, artist, mood, tags, src: SRC(n), hue });
export const TRACKS = [
  T('m01', 'Sunrise Drive', 'SoundHelix', 'joyeux', ['happy', 'fun', 'pop', 'voyage', 'فرح'], 1, 45),
  T('m02', 'Night Pulse', 'SoundHelix', 'energique', ['energy', 'sport', 'electro', 'party', 'حماس'], 2, 280),
  T('m03', 'Calm Horizon', 'SoundHelix', 'calme', ['calm', 'chill', 'nature', 'relax', 'هدوء'], 3, 190),
  T('m04', 'Golden Hour', 'SoundHelix', 'nostalgique', ['nostalgia', 'sunset', 'emotion', 'حنين'], 4, 28),
  T('m05', 'City Lights', 'SoundHelix', 'moderne', ['urban', 'city', 'night', 'hiphop', 'مدينة'], 5, 320),
  T('m06', 'Little Steps', 'SoundHelix', 'mignon', ['cute', 'kids', 'animals', 'poussin', 'baby', 'طفل', 'حيوان'], 6, 330),
  T('m07', 'Epic Rise', 'SoundHelix', 'epique', ['epic', 'cinematic', 'adventure', 'مغامرة'], 7, 8),
  T('m08', 'Soft Rain', 'SoundHelix', 'doux', ['soft', 'rain', 'piano', 'love', 'حب'], 8, 210),
  T('m09', 'Dance Floor', 'SoundHelix', 'fete', ['dance', 'party', 'wedding', 'fete', 'عرس', 'رقص'], 9, 120),
  T('m10', 'Open Road', 'SoundHelix', 'voyage', ['travel', 'road', 'summer', 'سفر'], 10, 170),
];
const pub = (t) => ({ id: t.id, name: t.name, artist: t.artist, mood: t.mood, tags: t.tags, audio: `https://www.soundhelix.com/examples/mp3/${t.src.split('/').pop()}`, cover: `/api/music/${t.id}/cover.svg` });
export const byId = (id) => TRACKS.find((t) => t.id === id);
export const search = (q = '') => {
  q = q.trim().toLowerCase();
  return TRACKS.filter((t) => !q || [t.name, t.artist, t.mood, ...t.tags].join(' ').toLowerCase().includes(q)).map(pub);
};
export const suggest = (words, n = 3) => {
  const w = words.map((x) => x.toLowerCase());
  const score = (t) => [t.mood, ...t.tags].reduce((s, k) => s + (w.some((x) => x.includes(k.toLowerCase()) || k.toLowerCase().includes(x)) ? 2 : 0), 0) + Math.random() * 0.5;
  return [...TRACKS].sort((a, b) => score(b) - score(a)).slice(0, n).map(pub);
};
export const coverSvg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${t.hue},80%,55%)"/><stop offset="1" stop-color="hsl(${(t.hue + 60) % 360},70%,30%)"/></linearGradient></defs><rect width="96" height="96" rx="14" fill="url(#g)"/><text x="48" y="60" font-size="38" text-anchor="middle" fill="#fff">♫</text></svg>`;
