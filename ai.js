// AI: answers what the user asks. Uses an LLM when AI_API_KEY is set (OpenAI-compatible), else built-in rules.
import { suggest } from './music.js';

const has = (s, ...k) => k.some((x) => s.includes(x));
export function detectIntent(p = '') {
  const s = p.toLowerCase();
  if (has(s, 'موسيق', 'صوت', 'musique', 'music', 'son ', 'chanson')) return 'music';
  if (has(s, 'تعليق', 'commentaire', 'comment', 'caption')) return 'comment';
  if (has(s, 'كارتون', 'كارطون', 'cartoon', 'dessin')) return 'cartoon';
  if (has(s, 'تقمص', 'شخصية', 'personnage', 'persona', 'incarne')) return 'persona';
  if (has(s, 'صورة', 'جودة', 'ألوان', 'الوان', 'ضوء', 'image', 'couleur', 'eclairage', 'éclairage', 'amélior', 'ameliore', 'enhance')) return 'enhance';
  if (has(s, 'وصف', 'description', 'décri', 'decri')) return 'description';
  return 'all';
}

const PERSONAS = [
  { name: 'Le commentateur sportif', text: 'Incroyable ! Regardez cette action, le public est debout ! ⚽🔥' },
  { name: 'Le sage', text: 'Mon enfant, un tel moment vaut de l’or. N’oublie pas de sourire. 🌿' },
  { name: 'Le présentateur du journal', text: 'Dernière minute : un nouveau clip fait sensation sur Arena Clips ! 📺' },
];

export function ruleBased(prompt, ctx = {}) {
  const intent = detectIntent(prompt);
  const b = ctx.brightness ?? 0.5, sat = ctx.saturation ?? 0.5;
  const dark = b < 0.38, bright = b > 0.72, flat = sat < 0.3;
  const land = ctx.orientation === 'landscape';
  const base = (ctx.description || '').trim();
  const mood = dark ? 'night' : bright ? 'happy' : flat ? 'calm' : 'energy';
  const scene = dark ? 'Une scène de nuit' : bright ? 'Une scène ensoleillée' : 'Une belle scène';
  const items = [];
  const add = (i) => items.push(i);
  const want = (k) => intent === 'all' || intent === k;

  if (want('description')) {
    const d1 = `${scene} ${land ? 'en format paysage' : 'en format vertical'} 🎬 ${base}`.trim();
    add({ type: 'description', title: 'Description prête', text: d1, use: { description: d1 } });
    add({ type: 'description', title: 'Description courte', text: `${scene} ✨ Qu’en pensez-vous ?`, use: { description: `${scene} ✨ Qu’en pensez-vous ?` } });
  }
  if (want('comment')) {
    add({ type: 'comment', title: 'Commentaire prêt', text: 'Un moment à ne pas manquer ! 😍 Partagez ce clip avec vos amis.', use: { description: 'Un moment à ne pas manquer ! 😍 Partagez ce clip avec vos amis.' } });
    add({ type: 'comment', title: 'Commentaire fun', text: 'Toujours au rendez-vous 😎🔥', use: { description: 'Toujours au rendez-vous 😎🔥' } });
  }
  if (want('music')) {
    const words = [mood, prompt, base];
    for (const t of suggest(words.join(' ').split(/\s+/).concat(mood), 3)) add({ type: 'music', title: t.name, text: `${t.artist} · ${t.mood}`, track: t });
  }
  if (want('enhance')) {
    const p = dark ? { name: 'Éclairage renforcé', eclairage: 18, couleur: 10 } : bright ? { name: 'Lumière adoucie', eclairage: -8, couleur: 12 } : { name: 'Couleurs vives', eclairage: 4, couleur: 22 };
    add({ type: 'enhance', title: 'Amélioration de l’image', text: `${p.name} : éclairage ${p.eclairage > 0 ? '+' : ''}${p.eclairage} %, couleurs +${p.couleur} %${flat ? ' (couleurs ternes)' : ''}`, use: { fx: 'enhance', eclairage: p.eclairage, couleur: p.couleur } });
  }
  if (want('cartoon')) add({ type: 'cartoon', title: 'Style cartoon', text: 'Transforme la vidéo en dessin animé : aplats de couleur et contours nets', use: { fx: 'cartoon' } });
  if (want('persona')) for (const p of PERSONAS.slice(0, intent === 'persona' ? 3 : 1)) add({ type: 'persona', title: `Personnage : ${p.name}`, text: p.text, use: { description: p.text } });
  if (intent === 'all') items.splice(8);
  const lead = { all: 'J’ai regardé la vidéo, voici mes suggestions. Appuyez sur « Utiliser » pour celle qui vous plaît.', music: 'Voici 3 musiques qui vont bien avec la vidéo :', description: 'Voici des descriptions prêtes :', comment: 'Voici des commentaires prêts :', enhance: 'Voici l’amélioration que je propose :', cartoon: 'Je peux transformer la vidéo en cartoon :', persona: 'Choisissez le personnage :' }[intent];
  return { intent, reply: lead, items };
}

export async function ask(prompt, ctx) {
  const base = ruleBased(prompt, ctx);
  const key = process.env.AI_API_KEY;
  if (!key || !prompt) return base;
  try {
    const frames = (ctx.frames || []).slice(0, 3).map((u) => ({ type: 'image_url', image_url: { url: u } }));
    const r = await fetch(`${process.env.AI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are AI inside a short-video publishing screen. Reply in French. Look at the video frames. Return JSON {"reply": string, "texts": [string, string], "moodWords": [string]} where texts are ready-to-use descriptions/comments/persona lines matching the request, and moodWords are 3-5 English mood keywords (happy, calm, energy, cute, epic, travel, dance, night, love) for choosing music.' },
          { role: 'user', content: [{ type: 'text', text: `Request: ${prompt}\nCurrent description: ${ctx.description || ''}` }, ...frames] },
        ],
      }),
    });
    if (!r.ok) throw new Error('llm ' + r.status);
    const j = JSON.parse((await r.json()).choices[0].message.content);
    const out = { ...base, reply: j.reply || base.reply };
    if (base.intent === 'music' && j.moodWords?.length) out.items = suggest(j.moodWords, 3).map((t) => ({ type: 'music', title: t.name, text: `${t.artist} · ${t.mood}`, track: t }));
    else if (['description', 'comment', 'persona', 'all'].includes(base.intent) && j.texts?.length) {
      const t = base.intent === 'comment' ? 'comment' : base.intent === 'persona' ? 'persona' : 'description';
      out.items = [...j.texts.map((x) => ({ type: t, title: t === 'comment' ? 'Commentaire prêt' : t === 'persona' ? 'Personnage' : 'Description prête', text: x, use: { description: x } })), ...base.items.filter((i) => !['description', 'comment', 'persona'].includes(i.type) || base.intent === 'all' && i.type !== t)];
    }
    return out;
  } catch (e) { console.error('ai', e.message); return base; }
}

// "Ask AI" on a published clip: French answers. LLM when AI_API_KEY is set, otherwise built-in French templates.
const tags = (t) => [...new Set((t.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []).slice(0, 3))].map((w) => '#' + w);
export function clipRules(prompt, clip = {}) {
  const p = prompt.toLowerCase(), cap = (clip.caption || '').trim() || 'ce nouveau clip', by = clip.author || 'le créateur';
  const hs = ['#ArenaClips', ...tags(cap)].join(' ');
  if (has(p, 'hashtag', 'tag')) return `${hs} #clip #video`;
  if (has(p, 'commentaire', 'comment', 'répon', 'repon')) return `Superbe clip, bravo ${by} ! Continuez comme ça.`;
  if (has(p, 'titre', 'title')) return `${cap.split(/[.!?\n]/)[0].slice(0, 60)} | Arena Clips`;
  if (has(p, 'résum', 'resum', 'décri', 'decri', 'explique')) return `Un clip de ${by} sur Arena Clips : « ${cap} ». À découvrir et à partager.`;
  return `Découvrez « ${cap} », un clip de ${by} sur Arena Clips. À regarder et à partager ! ${hs}`;
}
export async function askClip(prompt, clip) {
  const base = clipRules(prompt, clip), key = process.env.AI_API_KEY;
  if (!key || !prompt) return { reply: base, source: 'rules' };
  try {
    const r = await fetch(`${process.env.AI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'gpt-4o-mini', messages: [
        { role: 'system', content: 'Tu es l\u2019assistant d\u2019Arena Clips. Réponds toujours en français professionnel, de façon concise (moins de 80 mots), sur le clip décrit.' },
        { role: 'user', content: `Clip de ${clip.author || 'inconnu'} : « ${clip.caption || ''} ».\nDemande : ${prompt}` }] }),
    });
    if (!r.ok) throw new Error('llm ' + r.status);
    return { reply: (await r.json()).choices[0].message.content.trim(), source: 'llm' };
  } catch (e) { console.error('ai', e.message); return { reply: base, source: 'rules' }; }
}
