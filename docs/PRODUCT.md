# YourTube — product direction

The durable record of what YourTube is, what it isn't, and why. The [README](../README.md) is the user guide; this is the rationale. Update it when a decision changes, not after the fact.

## The problem

I open YouTube with an intent. Within seconds it is gone: the thumbnails, the algorithm and my own dopamine-seeking brain take over. The moment between *opening YouTube* and *pressing play* is where I lose.

Specifically:

- **Triage is slow and hostile.** The subscription feed shows two videos per screen, each behind a thumbnail engineered to be clicked. *(Solved by v1.)*
- **My feeds are a hodgepodge.** Subscriptions mix podcasts, music, several sports, AI, markets and gadgets, in many formats (reviews, explainers, news, highlights). YouTube's topic chips exist only on Home.
- **My own sorting can't be trusted.** I save videos for later, but I sort them while in the compromised state, so every playlist collapsed into "info". Playlists grow past 100 items and the back of them never gets watched.

## The governing principle: alignment with YouTube

YouTube serves many stakeholders. Where its interests align with mine, I use it; where they don't, I pay or I build.

| | What | Why |
|---|---|---|
| **Use** | Recommendations, discovery, catalog search, Ask (Gemini on a video: transcript, web search, related videos) | YouTube has my full history and the best algorithm; Ask already has tools I would never rebuild. |
| **Pay** | Premium: no ads, Jump Ahead | Ads are where we are misaligned, and YouTube sells the fix. So playback stays in the official app: no yt-dlp, no third-party frontends, no patched clients. |
| **Build** | A distraction-free feed, and filtering by intent | YouTube optimises for watch time. It will never ship a calm feed. |

Corollary: **build thin where YouTube might eventually build it** (the classifier is the obvious case), so ours is cheap to throw away.

## Principles

- **Solve the problem, no self-imposed handicaps.** Background work, a backend, an API key: all fine when they serve the problem. ("No backend" in v1 was a convenience, never a principle.)
- **Watching always happens in the official app.** Premium features exist only there.
- **Nothing that risks the Google account.** It holds far more than YouTube. No ad-blocking, no patched apps, no bot-like volume on the signed-in session (see [Account safety](#account-safety)).
- **Calm by default.** No thumbnails, no Shorts, no autoplay.
- **I decide what is worth my time; the machine decides where it goes.** Sorting must not depend on my in-the-moment judgement.
- **Personal software.** Built for me. Friends may fork it and bring their own infrastructure; no onboarding or multi-user polish.
- Elegant, no bloat. Measure on the device before claiming a fix.

## What it is

A layer between *opening YouTube* and *pressing play* that preserves intent, in two modes:

**Triage** (daily, ephemeral) — the subscription feed (also Home, Watch Later, any playlist page).
1. **Narrow:** filter rows by lane, format or a typed intent.
2. **Decide:** read title and metadata; tap ✦ Ask for a summary when unsure.
3. **Act:** watch now in the app, or **Keep** — YourTube saves it to the right lane playlist.

**Backlog** (durable, for downtime) — machine-curated playlists, one per lane, watchable anywhere including the official app.

## What it isn't

- **A player.** Playback is the official app's job.
- **A recommender or search engine.** It only filters, sorts and routes what I already have. Catalog-wide search stays with YouTube (search filters, and Ask YouTube where available).
- **A chat or LLM product.** YouTube's Ask is the AI layer for a video. No bring-your-own-LLM.
- **A bait detector.** Metadata cannot tell bait apart; only the transcript can, and that is Ask's territory.
- **A blocker or habit tracker.** It shapes the choice; it doesn't police it.

## Classification

### Who writes the questions, who answers them

- **An LLM writes the questions** — rare, cheap, needs judgement: draft lanes and their definitions from my real subscriptions and titles. I edit and approve.
- **A decision model answers them** (Clef / Gemini Decision / Jev) — frequent, fast, typed, calibrated: is this video one of those?

### What is asked about every video

| Axis | Type | Defined by | Changes |
|---|---|---|---|
| **Format** — review, explainer, news/commentary, podcast/interview, tutorial, highlights, stream VOD, music | choice | fixed in code | never |
| **Lanes** — my topics (e.g. AI, Markets, Gadgets, Cricket, NBA) | one yes/no per lane | LLM-drafted, I approve | rarely |
| **Shelf life** — hours, days, weeks, months, evergreen | score | fixed in code | never |
| **Intent** — "something light while I eat" | yes/no | typed by me | per session |

- **Question type follows the shape of the answer.** Lanes are independent yes/no questions, so a video can sit in several (an Anthropic IPO video is both AI and Markets) and adding a lane never changes the existing answers. A typed intent is the same mechanism; a repeated intent can be promoted to a lane.
- **Shelf life is a score, not "is it stale?".** The model estimates a timeless property (cached forever); the code compares it with the video's age at render time to decide staleness.
- **Low confidence is information.** Calibrated probabilities show when a video fits no lane. When that unmatched share grows (~15%), the LLM proposes a lane from those videos; nothing changes without my approval. No scheduled redrafts.
- **Lanes are stable.** They become playlist names, so redrafting them is a rare, deliberate event.

### What the classifier sees

- Text only: title, channel, duration, plus description, tags, category and topic categories from the **YouTube Data API**, called by the Worker with an API key (free quota: 10,000 units/day; `videos.list` costs 1 unit per 50 videos). The lookups never touch my signed-in session.
- Before building, survey the full Data API surface (video and channel resources) for any other useful signals; channel-level data cached per channel is a likely prior for single-topic channels.
- **No thumbnails.** For topic, format and shelf life they carry little the text doesn't, at the cost of image tokens and multi-second latency. Revisit only if format accuracy measurably suffers.
- YouTube's own category is creator-chosen and coarse (market commentary and an AI-IPO analysis are both "Education"): an input feature, never the classifier.

### Where it runs

- A small **Cloudflare Worker** (mine, free tier): enrich via the Data API → decision model → cache per video ID, forever. Each video is classified once.
- Decision model behind the Worker is swappable; they share one question format (noul / choice / score). Default **Clef-flash** via the Workers AI binding (no extra key; ~1.2M free tokens/day ≈ 3,000 videos). **Gemini Decision 1** (Nov 2026; free tier, 1,000 questions per request) is the alternative.
- On-device (Pixel TPU via AICore / Gemini Nano) is unreachable from a web page; not pursued.

## Backlog structure

| Playlist | Role |
|---|---|
| **Watch Later** | Manual escape hatch: anything I want soon, including short-lived videos. Occasionally migrated. |
| **Lane playlists** | Machine-curated, one per lane. Fed by **Keep**. Tracked by playlist ID; visibly marked as machine-curated. |
| **Manual playlists** | Purpose-built by me (e.g. music); never touched by the machine. |
| **Legacy playlists** (info / infotainment / entertainment) | Sorting is ruined; migrated once into lanes, some time later. |

- **Keep** saves to the single best-matching lane.
- **Only long shelf-life videos enter the backlog.** Short-lived ones live and die in triage; if I don't get to them while they're in the feed, they didn't matter. Watch Later covers exceptions.
- **Migrations re-triage.** Watch Later and legacy items go through the same gate: long-lived ones move to lanes, stale ones are proposed for removal, with one approval from me for the whole batch.
- Classification alone doesn't fix "the back never gets watched": lane playlists will grow too. The backlog view must order for consumption (evergreen, oldest-saved first) and handle watched items.

## Account safety

YouTube's Terms forbid automated access without permission; the official Data API is that permission. Enforcement targets bot-like patterns (volume, speed, regularity). Therefore:

- **Reads for classification** go through the Data API with an API key, not the session.
- **Single writes I trigger** (Keep) use the page's own save action, the same thing YouTube's Save button does.
- **Bulk writes** (migrations) use the official API with OAuth, throttled (~200 inserts/day at 50 units each).

## Surface

A **userscript on m.youtube.com** (Vivaldi + Tampermonkey on Android, installable as a home-screen web app).

- It runs inside the signed-in session, so Ask, Watch Later and private playlists work with no OAuth and no keys.
- **Split by what needs the session.** Only Ask, reading Watch Later and private playlists, Keep, and rendering must run on `m.youtube.com`; a userscript is the lightest thing that can. Everything else (metadata, classification, cache, scheduled work) lives in the Worker, which the page can reach directly: `m.youtube.com` sets no `connect-src` CSP, so a CORS-enabled Worker needs no special grants.
- **Fallback:** if userscripts stop working in the browser, the same code becomes an MV3 extension content script. A separate site or native app can't call Ask or read Watch Later, which rules them out.
- **Rejected:** patched or modded clients (ReVanced etc.: ban risk to the main account); YouTube Lite (no Jump Ahead); WebView wrapper apps (Google blocks sign-in in WebViews); Chrome (no extensions on Android); yt-dlp and third-party frontends (lose Premium; see the alignment principle).

## Open questions

- **Auto-fill with a human in the loop.** v1 of the backlog is Keep-driven. Can the machine propose additions for batch approval without becoming a recommender? Needs workshopping.
- **Typed intent:** in the first classifier release, or later?
- **The lanes themselves:** to be drafted from my real subscriptions and titles, once the product above is settled.
- **Watched items in lane playlists:** removed, hidden in the backlog view, or left alone?
- **Decorate YouTube's pages or render our own** (still inside m.youtube.com)? Filtering a 100+ item playlist by lane needs all of it loaded, which YouTube's page doesn't do.
