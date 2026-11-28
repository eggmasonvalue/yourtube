import { createHash } from 'node:crypto';

// Classification: atomic questions for a decision model, and the code that turns answers into decisions.
// The model answers what is visible at a glance; all reasoning lives here. The owner's topics and lanes come
// from a private config (personal/topics.mjs), so this file holds only what is the same for everyone.
//
// A question: { ask, yes, no } — `ask` is the noul instruction; `yes`/`no` describe what is visible in the
// inputs when the answer is yes or no (mapped to the API's own field names at call time). Descriptions never
// refer to other questions.

// ── Timeliness cues → shelf life ───────────────────────────────────────────────
export const CUES = {
  event: {
    ask: 'Is it about a specific event that just happened or is about to happen?',
    yes: 'News, an announcement, a launch, a match or race, an earnings release, a rumour, a dated preview.',
    no: 'A topic that is not tied to a particular date.',
  },
  recap: {
    ask: 'Is it highlights or a recap of a sports game, race, or TV episode?',
    yes: 'Game or race highlights, a post-game or post-race breakdown, a reaction to a match, an episode recap.',
    no: 'Anything else, including a clip or excerpt from a podcast, interview or talk.',
  },
  prices: {
    ask: 'Does it comment on current prices or market moves?',
    yes: 'Today\'s or this week\'s stock, index, crypto or commodity moves; price targets; what to buy now.',
    no: 'No mention of current prices or recent market moves.',
  },
  review: {
    ask: 'Is it a review, hands-on or comparison of a product?',
    yes: 'A product review, first impressions, unboxing, a "vs" comparison, a buying guide.',
    no: 'No specific product is being judged.',
  },
  explainer: {
    ask: 'Does it explain how something works, or teach a skill?',
    yes: 'An explainer, a tutorial, a lecture, a course, a deep dive on a concept.',
    no: 'News, opinion, entertainment or a story, without teaching anything.',
  },
  story: {
    ask: 'Does it tell the story or history of a company, a person, an event or an era?',
    yes: 'A documentary, a profile, a "how X happened" or "rise and fall of" narrative.',
    no: 'No narrative about the past.',
  },
  fast_changing: {
    ask: 'Is it about a fast-changing tool, app or technology?',
    yes: 'Software tools, AI models and coding tools, apps, platforms or gadgets that get new versions every few months.',
    no: 'Ideas, skills, history, people, sports or other subjects that do not depend on a product version.',
  },
};

// ── Listening cues → listen ────────────────────────────────────────────────────
export const LISTEN = {
  talk: {
    ask: 'Is it mainly people talking?',
    yes: 'A podcast, an interview, a lecture, a talking head, a commentary or a discussion.',
    no: 'Mostly footage, music, gameplay, demonstrations or action.',
  },
  visual: {
    ask: 'Does it depend on seeing the screen?',
    yes: 'Product shots, demos, charts, code on screen, gameplay, footage of a match or race, a workout to follow.',
    no: 'It can be followed by listening alone.',
  },
};

// ── Logic ──────────────────────────────────────────────────────────────────────
export const FIRES = 0.5;     // a calibrated yes
export const UNSURE = 0.3;    // below this, a cue clearly didn't fire
export const CONFIDENT = 0.8; // suggestions need a confident lane

const on = (a, k) => (a[k] ?? 0) >= FIRES;

// Shelf life, in days (Infinity = evergreen). First matching rule wins; tuned by the test suite.
// Fast-changing subjects (tools, apps, models) cap at ~6 months even when they explain or tell a story.
export const shelfLife = a => {
  const lasting = (a.fast_changing ?? 0) >= UNSURE ? 180 : Infinity; // when in doubt, assume it ages
  const timely = Math.max(a.event ?? 0, a.recap ?? 0, a.prices ?? 0);
  return on(a, 'recap') ? 3
    : on(a, 'prices') && !on(a, 'explainer') ? 3
    : on(a, 'event') && !on(a, 'explainer') && !on(a, 'story') ? 7
    : on(a, 'event') ? 60          // explains or narrates an event: lasts a while
    : on(a, 'review') ? 180
    : on(a, 'explainer') || on(a, 'story') ? lasting
    : timely >= UNSURE ? 30         // a timing cue almost fired: assume weeks
    : lasting;                      // not tied to a date
};

// Listen: mostly talk that doesn't need the screen; long conversations count even with some screen use.
// `minutes` comes from metadata.
export const listen = (a, { minutes = 0 } = {}) =>
  on(a, 'talk') && (!on(a, 'visual') || ((a.talk ?? 0) >= 0.8 && minutes >= 30));

// Lanes from topics: a lane's score is its strongest topic. `config.lanes` maps lane → topic keys;
// `config.unless` maps a topic → topics that, when they fire, make it not count (e.g. business unless stocks).
const topicScore = (a, t, config) => (config.unless?.[t] ?? []).some(u => on(a, u)) ? 0 : a[t] ?? 0;
export const laneScores = (a, config) =>
  Object.fromEntries(Object.entries(config.lanes).map(([lane, topics]) => [lane, Math.max(...topics.map(t => topicScore(a, t, config)))]));

export const lanes = (a, config) => Object.entries(laneScores(a, config)).filter(([, p]) => p >= FIRES).map(([l]) => l);

// Keep: the lane with the strongest topic; null when no lane fits (the page asks me to pick).
// Shelf life never routes: it only orders the backlog and drives the stale review.
export const keepTarget = (a, config) => {
  const [best, p] = Object.entries(laneScores(a, config)).sort((x, y) => y[1] - x[1])[0] ?? [];
  return p >= FIRES ? best : null;
};

export const unmatched = (a, config) => lanes(a, config).length === 0;

// ── Input: what the model sees (text only) ─────────────────────────────────────
// From Data API resources. The reviewed cases were asked with exactly this; changing it changes the answers.
const squash = (s, n) => (s ?? '').replace(/\s+/g, ' ').slice(0, n);
export const seconds = iso => {
  const m = (iso ?? '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) ?? [];
  return ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};
export const about = channel => squash(channel?.snippet?.description, 300).split(/(?<=[.!?])\s/)[0].slice(0, 120).trim();
export const fromApi = (v, about) => {
  const minutes = Math.round(seconds(v.contentDetails.duration) / 60);
  return {
    video: { title: v.snippet.title, channelName: v.snippet.channelTitle, duration: minutes ? `${minutes} min` : '',
      tags: (v.snippet.tags ?? []).slice(0, 12), description: squash(v.snippet.description, 300) },
    channel: { about },
    minutes,
  };
};

export const state = (v, channel = {}) => [
  `Title: ${v.title}`,
  `Channel: ${v.channelName}${channel.about ? ` (${channel.about})` : ''}`,
  v.duration && `Length: ${v.duration}`,
  v.tags?.length && `Tags: ${v.tags.join(', ')}`,
  v.description && `Description: ${v.description}`,
].filter(Boolean).join('\n').toWellFormed(); // truncated descriptions can split an emoji's surrogate pair

// Every question for one video: the owner's topics plus the shared cues.
export const questions = config => ({ ...config.topics, ...CUES, ...LISTEN });

// A question's signature: answers are cached against it, so rewording a question asks it again.
export const sig = q => createHash('sha1').update(JSON.stringify(q)).digest('hex').slice(0, 8);
