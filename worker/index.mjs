// YourTube Worker: classifies my subscriptions' uploads as they're published, and serves the results to the userscript.
//   YouTube push (WebSub)  GET/POST /hub: a subscribed channel uploads → enrich from the Data API → ask the decision model
//   PUT  /channels {ids}   the subscription list, sent by the userscript
//   POST /classify {ids}   → { id: derived outputs }; ids never seen (Keep, a migration) are classified on the spot
//   POST /intent {text}    → ids of subscription uploads that haven't gone stale and fit a typed intent, newest first
//   cron, every 10 min     renew push subscriptions; retry videos the model couldn't answer
// Answers are cached per video; lanes, shelf life and listen are derived on every read, so a logic change applies at once.
import { providers } from './decide.mjs';
import { questions, sig, fromApi, about, seconds, state, lanes, keepTarget, shelfLife, listen, unmatched } from './classify.mjs';
import * as config from '../personal/topics.mjs'; // the owner's topics and lanes: private, bring your own

const HOUR = 36e5, DAY = 24 * HOUR;
const HUB = 'https://pubsubhubbub.appspot.com/subscribe';
const LEASE = 10 * DAY;  // asked of the hub; it may grant less, and the verification says how much
const RENEWALS = 30;     // per cron run: 1,422 channels take ~8 h to subscribe, then renewals trickle
const RETRIES = 12;      // videos re-asked per cron run
const SHORT = 180;       // seconds: Shorts and clips are left out of the feed, so aren't asked unless the page asks

const QS = questions(config);
const SIGS = Object.fromEntries(Object.entries(QS).map(([id, q]) => [id, sig(q)]));
const SET = sig(SIGS);

const yt = (env, path, params) =>
  fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: env.YT_KEY })}`).then(r => r.json());
const IN = 'IN (SELECT value FROM json_each(?1))';
const topic = channel => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channel}`;

// ── Classification ─────────────────────────────────────────────────────────────
// Fetch what the model sees for videos not yet enriched, plus the about line of channels not seen before.
// Music is never asked; nor are short uploads, unless the page asked. Premieres and lives wait for the notification
// YouTube sends once they become a video.
const enrich = async (env, list) => {
  const { results } = await env.DB.prepare(`SELECT id FROM videos WHERE meta IS NULL AND id ${IN}`).bind(JSON.stringify(list)).all();
  if (!results.length) return;
  const r = await yt(env, 'videos', { part: 'snippet,contentDetails', id: results.map(v => v.id).join(','),
    fields: 'items(id,snippet(publishedAt,channelId,title,description,channelTitle,tags,categoryId,liveBroadcastContent),contentDetails/duration)' });
  if (r.error) return console.log('enrich', r.error.message);
  const found = r.items ?? [], ready = found.filter(v => v.snippet.liveBroadcastContent === 'none');
  const chans = [...new Set(ready.map(v => v.snippet.channelId))];
  const known = (await env.DB.prepare(`SELECT id, about FROM channels WHERE about IS NOT NULL AND id ${IN}`).bind(JSON.stringify(chans)).all()).results;
  const abouts = Object.fromEntries(known.map(c => [c.id, c.about]));
  const fresh = chans.filter(c => !(c in abouts));
  const fetched = fresh.length ? (await yt(env, 'channels', { part: 'snippet', id: fresh.join(','), fields: 'items(id,snippet/description)' })).items ?? [] : [];
  for (const c of fetched) abouts[c.id] = about(c);
  const gone = results.filter(v => !found.some(f => f.id === v.id));
  await env.DB.batch([
    ...fetched.map(c => env.DB.prepare('INSERT INTO channels (id, about) VALUES (?1, ?2) ON CONFLICT (id) DO UPDATE SET about = ?2').bind(c.id, abouts[c.id])),
    ...ready.map(v => env.DB.prepare(`UPDATE videos SET channel = ?2, published = ?3, category = ?4, meta = ?5,
        ask = CASE WHEN ?4 = 10 OR (ask = 1 AND ?6) THEN NULL ELSE ask END WHERE id = ?1`)
      .bind(v.id, v.snippet.channelId, Date.parse(v.snippet.publishedAt), +v.snippet.categoryId,
        JSON.stringify(fromApi(v, abouts[v.snippet.channelId] ?? '')), +(seconds(v.contentDetails.duration) <= SHORT))),
    ...found.filter(v => !ready.includes(v)).map(v => env.DB.prepare('UPDATE videos SET ask = NULL WHERE id = ?').bind(v.id)),
    ...gone.map(v => env.DB.prepare(`UPDATE videos SET meta = '{}', ask = NULL WHERE id = ?`).bind(v.id)), // private or deleted
  ]);
};

// Ask the decision model the questions each video hasn't been asked in their current wording. No retries here:
// a failure stays pending for the cron, so a request never waits on Gemini's rate limit.
const ask = async (env, list) => {
  const { results } = await env.DB.prepare(`SELECT id, meta, asked FROM videos WHERE ask AND meta IS NOT NULL AND meta != '{}' AND id ${IN}`)
    .bind(JSON.stringify(list)).all();
  const decide = providers.gemini({ key: env.GEMINI_KEY, retries: 0 });
  const writes = await Promise.all(results.map(async row => {
    const asked = JSON.parse(row.asked), { video, channel } = JSON.parse(row.meta);
    const missing = Object.fromEntries(Object.entries(QS).filter(([id]) => asked[id] !== SIGS[id]));
    try {
      const { answers } = await decide(state(video, channel), missing);
      return env.DB.prepare('UPDATE videos SET answers = json_patch(answers, ?2), asked = json_patch(asked, ?3), sig = ?4, ask = NULL WHERE id = ?1')
        .bind(row.id, JSON.stringify(answers), JSON.stringify(SIGS), SET);
    } catch (e) {
      console.log('ask', row.id, e.message.slice(0, 200));
      if (/^4(?!29)/.test(e.message)) return env.DB.prepare('UPDATE videos SET ask = NULL WHERE id = ?').bind(row.id); // rejected: don't retry
    }
  }));
  const done = writes.filter(Boolean);
  if (done.length) await env.DB.batch(done);
};

const classify = async (env, list) => { await enrich(env, list); await ask(env, list); };

// What the page reads. Evergreen shelf life is null (JSON has no Infinity).
const derive = row => {
  if (!row?.meta) return { pending: true };
  if (row.meta === '{}') return { gone: true };
  if (row.category === 10) return { music: true };
  const a = JSON.parse(row.answers);
  if (!Object.keys(a).length) return row.ask ? { pending: true } : {}; // a short upload nobody asked about
  const shelf = shelfLife(a);
  return {
    lanes: lanes(a, config), keep: keepTarget(a, config), shelf: shelf === Infinity ? null : shelf,
    listen: listen(a, JSON.parse(row.meta)), unmatched: unmatched(a, config),
    ...(row.sig !== SET && { pending: true }), // some questions are new since it was asked
  };
};

// ── Push notifications (WebSub) ────────────────────────────────────────────────
// The hub confirms a subscription by asking for the challenge back; the lease it grants is recorded.
const verify = async (env, url) => {
  const p = url.searchParams, channel = new URL(p.get('hub.topic') ?? 'x:').searchParams.get('channel_id');
  if (p.get('hub.mode') === 'subscribe') {
    const ok = await env.DB.prepare('UPDATE channels SET lease = ? WHERE id = ? AND subscribed')
      .bind(Date.now() + +p.get('hub.lease_seconds') * 1000, channel).run();
    if (!ok.meta.changes) return new Response(null, { status: 404 });
  }
  return new Response(p.get('hub.challenge'));
};

const signed = async (env, body, header) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  return header === `sha1=${mac}`;
};

// An upload, or a title or description edit. Only new uploads from subscribed channels are taken; an edit of an
// older video carries its old publish date.
const notified = async (env, req, ctx) => {
  const body = await req.text();
  if (!await signed(env, body, req.headers.get('x-hub-signature'))) return new Response(null, { status: 403 });
  const tag = t => body.match(new RegExp(`<${t}>([^<]+)</${t}>`))?.[1];
  const [id, channel, published] = [tag('yt:videoId'), tag('yt:channelId'), Date.parse(tag('published'))];
  if (id && published > Date.now() - 2 * DAY) {
    const r = await env.DB.prepare(`INSERT INTO videos (id, channel, published, ask) SELECT ?1, ?2, ?3, 1
        WHERE EXISTS (SELECT 1 FROM channels WHERE id = ?2 AND subscribed)
        ON CONFLICT (id) DO UPDATE SET ask = 1 WHERE meta IS NULL`).bind(id, channel, published).run(); // a premiere, now a video
    if (r.meta.changes) ctx.waitUntil(classify(env, [id]));
  }
  return new Response(null, { status: 204 });
};

// Subscribe channels whose lease is missing or ends within a day. The hub verifies asynchronously (and sets the real
// lease); until then the channel's lease is parked so it comes up again in an hour.
const renew = async (env, now = Date.now()) => {
  const { results } = await env.DB.prepare('SELECT id FROM channels WHERE subscribed AND lease < ? ORDER BY lease LIMIT ?').bind(now + DAY, RENEWALS).all();
  if (!results.length) return;
  await Promise.all(results.map(({ id }) => fetch(HUB, { method: 'POST', body: new URLSearchParams({
    'hub.mode': 'subscribe', 'hub.topic': topic(id), 'hub.callback': `${env.ORIGIN}/hub`, 'hub.verify': 'async',
    'hub.secret': env.TOKEN, 'hub.lease_seconds': String(LEASE / 1000) }) })
    .then(r => r.ok || console.log('renew', id, r.status))));
  const park = now + DAY + HOUR;
  await env.DB.prepare(`UPDATE channels SET lease = ?2 WHERE lease < ?2 AND id ${IN}`).bind(JSON.stringify(results.map(c => c.id)), park).run();
};

// ── Typed intent ───────────────────────────────────────────────────────────────
// One request: the intent is the input, each candidate video one yes/no question (the API takes up to 1,000).
// Candidates: classified uploads from subscribed channels, music excluded, younger than their shelf life.
const intent = async (env, { text }) => {
  const { results } = await env.DB.prepare(`SELECT v.id, v.published, v.meta, v.answers FROM videos v JOIN channels c ON c.id = v.channel
      WHERE c.subscribed AND v.sig IS NOT NULL AND v.category IS NOT 10 ORDER BY v.published DESC LIMIT 3000`).all();
  const now = Date.now();
  const fresh = results.filter(r => (now - r.published) / DAY < shelfLife(JSON.parse(r.answers))).slice(0, 1000);
  if (!fresh.length) return [];
  const qs = Object.fromEntries(fresh.map(r => {
    const { video } = JSON.parse(r.meta);
    return [r.id, { ask: `Does this video fit what I want? "${video.title}" by ${video.channelName}${video.duration ? `, ${video.duration}` : ''}.` }];
  }));
  const { answers } = await providers.gemini({ key: env.GEMINI_KEY, retries: 0 })(`What I want to watch: ${text}`, qs);
  return fresh.filter(r => answers[r.id] >= 0.5).map(r => r.id); // newest first, as selected
};

// ── Routes ─────────────────────────────────────────────────────────────────────
const routes = {
  'POST /intent': intent,
  'POST /classify': async (env, { ids: list }, ctx) => {
    const set = JSON.stringify(list), db = env.DB;
    const [, , { results }] = await db.batch([
      db.prepare(`INSERT OR IGNORE INTO videos (id, ask) SELECT value, 2 FROM json_each(?1)`).bind(set),
      db.prepare(`UPDATE videos SET ask = 2 WHERE id ${IN} AND sig IS NOT ?2 AND meta IS NOT '{}' AND category IS NOT 10`).bind(set, SET),
      db.prepare(`SELECT id, meta, category, answers, sig, ask FROM videos WHERE id ${IN}`).bind(set),
    ]);
    const rows = Object.fromEntries(results.map(r => [r.id, r]));
    const todo = list.filter(id => rows[id]?.ask).slice(0, 20); // the rest wait for the cron
    if (todo.length) ctx.waitUntil(classify(env, todo));
    return Object.fromEntries(list.map(id => [id, derive(rows[id])]));
  },
  'PUT /channels': async (env, { ids: list }) => {
    const set = JSON.stringify(list);
    await env.DB.batch([
      env.DB.prepare(`UPDATE channels SET subscribed = 0 WHERE subscribed AND id NOT ${IN}`).bind(set),
      env.DB.prepare(`INSERT INTO channels (id, subscribed) SELECT value, 1 FROM json_each(?1) WHERE true
        ON CONFLICT (id) DO UPDATE SET subscribed = 1 WHERE NOT subscribed`).bind(set),
    ]);
    return { channels: list.length };
  },
};

const CORS = {
  'access-control-allow-origin': 'https://m.youtube.com',
  'access-control-allow-methods': 'POST, PUT',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};
const reply = (body, status = 200) => Response.json(body, { status, headers: CORS });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/hub') return req.method === 'GET' ? verify(env, url) : notified(env, req, ctx);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.headers.get('authorization') !== `Bearer ${env.TOKEN}`) return reply({ error: 'unauthorized' }, 401);
    const route = routes[`${req.method} ${url.pathname}`];
    return route ? reply(await route(env, await req.json(), ctx)) : reply({ error: 'not found' }, 404);
  },
  async scheduled(_, env) {
    await renew(env);
    const { results } = await env.DB.prepare('SELECT id FROM videos WHERE ask ORDER BY ask DESC, published DESC LIMIT ?').bind(RETRIES).all();
    if (results.length) await classify(env, results.map(r => r.id));
  },
};
