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
  { name: 'المعلق الرياضي', text: 'وااااو شوفو هاد اللقطة! ما بقى والو، الجمهور واقف على رجليه! ⚽🔥' },
  { name: 'الجد الحكيم', text: 'يا ولدي، هادي لحظة كتسوى الدنيا. دير بالك تضيعها بلا ما تبتسم. 🌿' },
  { name: 'مذيع الأخبار', text: 'عاجل: لقطة جديدة تغزو أريـنا كليبس، والمتابعون ما قدروش يوقفو المشاهدة! 📺' },
];

export function ruleBased(prompt, ctx = {}) {
  const intent = detectIntent(prompt);
  const b = ctx.brightness ?? 0.5, sat = ctx.saturation ?? 0.5;
  const dark = b < 0.38, bright = b > 0.72, flat = sat < 0.3;
  const land = ctx.orientation === 'landscape';
  const base = (ctx.description || ctx.hint || '').trim();
  const mood = dark ? 'night' : bright ? 'happy' : flat ? 'calm' : 'energy';
  const scene = dark ? 'لقطة ليلية' : bright ? 'لقطة مشمسة' : 'لقطة جميلة';
  const items = [];
  const add = (i) => items.push(i);
  const want = (k) => intent === 'all' || intent === k;

  if (want('description')) {
    add({ type: 'description', title: 'وصف جاهز', text: `${scene} ${land ? 'بالعرض' : 'بالطول'} 🎬 ${base}`, use: { description: `${scene} ${land ? 'بالعرض' : 'بالطول'} 🎬 ${base}` } });
    add({ type: 'description', title: 'وصف قصير', text: `${scene} ✨ شنو كتقولو؟`, use: { description: `${scene} ✨ شنو كتقولو؟` } });
  }
  if (want('comment')) {
    add({ type: 'comment', title: 'تعليق جاهز', text: 'هادشي ما كيتعاودش! 😍 شاركو الكليب مع صحابكم.', use: { description: 'هادشي ما كيتعاودش! 😍 شاركو الكليب مع صحابكم.' } });
    add({ type: 'comment', title: 'تعليق مرح', text: 'ديما فالموعد 😎🔥', use: { description: 'ديما فالموعد 😎🔥' } });
  }
  if (want('music')) {
    const words = [mood, prompt, base];
    for (const t of suggest(words.join(' ').split(/\s+/).concat(mood), 3)) add({ type: 'music', title: t.name, text: `${t.artist} · ${t.mood}`, track: t });
  }
  if (want('enhance')) {
    const p = dark ? { name: 'تفتيح الإضاءة', eclairage: 18, couleur: 10 } : bright ? { name: 'تهدئة الإضاءة', eclairage: -8, couleur: 12 } : { name: 'ألوان حية', eclairage: 4, couleur: 22 };
    add({ type: 'enhance', title: 'تحسين الصورة', text: `${p.name}: Eclairage ${p.eclairage > 0 ? '+' : ''}${p.eclairage}%، ألوان +${p.couleur}%${flat ? ' (الألوان باهتة)' : ''}`, use: { fx: 'enhance', eclairage: p.eclairage, couleur: p.couleur } });
  }
  if (want('cartoon')) add({ type: 'cartoon', title: 'شكل كارطوني', text: 'تحويل الفيديو لرسوم متحركة بألوان مسطحة وحواف واضحة', use: { fx: 'cartoon' } });
  if (want('persona')) for (const p of PERSONAS.slice(0, intent === 'persona' ? 3 : 1)) add({ type: 'persona', title: `تقمص: ${p.name}`, text: p.text, use: { description: p.text } });
  if (intent === 'all') items.splice(8);
  const lead = { all: 'شفت الفيديو، هادو اقتراحاتي. غير ضغط "استعمل هادا" على اللي عجبك.', music: 'هادو 3 ديال الموسيقى اللي كتناسب الفيديو:', description: 'هادو أوصاف واجدين:', comment: 'هادو تعليقات واجدين:', enhance: 'هادا هو التحسين اللي كنقترح:', cartoon: 'نقدر نحول الفيديو لشكل كارطوني:', persona: 'اختار الشخصية اللي بغيتي:' }[intent];
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
          { role: 'system', content: 'You are AI inside a short-video publishing screen. Reply in Moroccan Darija (Arabic script). Look at the video frames. Return JSON {"reply": string, "texts": [string, string], "moodWords": [string]} where texts are ready-to-use descriptions/comments/persona lines matching the request, and moodWords are 3-5 English mood keywords (happy, calm, energy, cute, epic, travel, dance, night, love) for choosing music.' },
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
      out.items = [...j.texts.map((x) => ({ type: t, title: t === 'comment' ? 'تعليق جاهز' : t === 'persona' ? 'تقمص شخصية' : 'وصف جاهز', text: x, use: { description: x } })), ...base.items.filter((i) => !['description', 'comment', 'persona'].includes(i.type) || base.intent === 'all' && i.type !== t)];
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
