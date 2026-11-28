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

**Triage** (daily, ephemeral) — the subscription feed (also Watch Later and any playlist page). Home is out of scope: YouTube already filters it with its own topic chips.
1. **Narrow:** filter rows by lane, by *listen* (works as audio only) or by a typed intent. Music is hidden by default.
2. **Decide:** read title and metadata; tap ✦ Ask for a summary when unsure.
3. **Act:** watch now in the app, or **Keep** (the bookmark that replaces YouTube's ⋮) — YourTube saves it to the right lane playlist.

**Backlog** (durable, for downtime) — machine-curated playlists, one per lane, watchable anywhere including the official app.

## What it isn't

- **A player.** Playback is the official app's job.
- **A recommender or search engine.** It only filters, sorts and routes what I already have. Catalog-wide search stays with YouTube (search filters, and Ask YouTube where available).
- **A chat or LLM product.** YouTube's Ask is the AI layer for a video. No bring-your-own-LLM.
- **A bait detector.** Metadata cannot tell bait apart; only the transcript can, and that is Ask's territory.
- **A blocker or habit tracker.** It shapes the choice; it doesn't police it.

## Classification

### Who writes the questions, who answers them

- **A decision model answers; it doesn't reason.** Jev, Gemini Decision and Clef score each question in one pass and return calibrated probabilities, not text. They answer what is visible at a glance in the inputs.
- **The reasoning lives in code.** A composite judgement (a lane, a shelf life) is never one question: asking "which lane?" or "how long will this last?" makes the model do reasoning it can't. It is split into atomic questions, and code combines the answers.
- **An LLM writes the questions and the logic.** Rare, needs judgement: it drafts both from my data and maintains them. I approve.
- **Corrections come from normal use, never from review rounds.** Changing Keep's lane (one tap on the "Saved to <lane> · change" toast), marking a video "not this lane" in Keep's lane picker, or rejecting a stale proposal records the case with what I chose. Unticked suggestions are recorded but aren't corrections ("not worth my time" looks the same). Nothing is scheduled: when a few corrections pile up, or when I ask, an LLM session looks for a pattern, adjusts a question or the logic, and backtests against every past correction plus the 25 cases reviewed at launch. A logic change replays instantly from cached answers; only a new question asks the model again. A single miss waits until it's a pattern. If I never correct anything, nothing changes, and the conservative defaults (Watch Later when unsure, the 6-month cap) carry it.

### What is asked about every video

**A question exists only because a behaviour reads its answer, only if metadata can't answer it, and only if it can be answered at a glance.**

Atomic questions, cached per video forever:

| Group | Examples | Combined in code into |
|---|---|---|
| **Topics**, one `noul` per topic | "Is it about stocks or investing?", "Is it about an NBA game, player or team?" | lanes, the unmatched alarm |
| **Timeliness cues** | "Is it about a specific recent event?", "Is it a recap of a game or race?", "Is it a review of a product?", "Does it explain a concept or teach a skill?" | shelf life: days, weeks, months, evergreen |
| **Listening cues** | "Is it a conversation or a talking head?", "Does it depend on visuals: demos, charts, gameplay, screen recordings?" | listen |

Derived in code, from those answers and metadata:

| Output | Read by |
|---|---|
| **Lanes**, several possible | lane filter, Keep, suggestions |
| **Shelf life** | Keep gate, suggestions, backlog order, stale checks |
| **Listen** | the *listen* filter in triage and backlog |
| **Unmatched**: no topic fires | the ~15% alarm |

Asked per session, not cached: **typed intent** ("something light while I eat"), one `noul` per video over every classified subscription upload that hasn't gone stale, not just the loaded rows; one request carries up to 1,000 (in the first classifier release). A repeated intent can become a topic or a lane.

- **Metadata answers the rest, no model:** music (YouTube category 10, ~97% on a labelled sample), Shorts, length, live/upcoming, language, age, channel.
- **Not asked:** format (nothing reads it; "only interviews" is a typed intent), quality or bait (Ask's territory), worth my time (my call), mental effort (typed intent).
- **Independent `noul` questions, not one `choice`.** Topics overlap (an AI-IPO video is both AI and Markets). Independent questions keep "clearly both" (0.9/0.9) apart from "unsure" (0.5/0.5); a `choice` makes probabilities sum to one and splits them. A question's `true`/`false` descriptions name what is visible in the inputs and never refer to other questions.
- **Lanes are logic, not questions.** Redefining, merging or adding a lane edits code and replays cached answers. Only a subject no topic covers needs a new question, asked of the videos that still matter (the feed window and the backlog).
- **Listen is fixed, not a typed intent,** because listening is a recurring situation (commutes, chores, long podcasts), and it's a timeless property worth caching.
- **Shelf life is derived, never "is it stale?".** The cues are timeless and cached forever; code compares the derived shelf life with the video's age at render time.
- **Low confidence is information.** When the unmatched share grows (~15%), the LLM proposes a topic and a lane from those videos; nothing changes without my approval. No scheduled redrafts.
- **Lanes are stable.** They become playlist names, so redefining what a lane holds is cheap, but renaming or splitting one is a rare, deliberate event.

### Drafting lanes

Lanes are personal: they live in the owner's private config (`personal/`, a separate private repo, gitignored here), along with the data findings behind them. The method:

- **Three sources, three roles.** Subscriptions show supply: each channel's uploads over a fixed window, not a feed snapshot that daily posters dominate. Watch history shows **persistence and completion, never volume**: volume reflects what was easiest to reach. Saved playlists only test coverage: if watched videos get removed, what's left is what wasn't finished.
- **Label topics, then group.** Per channel, and per video for channels that span several subjects; group the labels into families. The families become the topic questions, and each lane is code over them.
- **Lasting interest or phase.** A family watched in most months with no dominant month is a lasting interest. One concentrated in a month or two is a phase: typed intent covers it, not a lane.
- **Split by the choice made in the moment** (building vs following an industry), not by subject taxonomy.
- **Few lanes, no catch-all:** about a dozen at most, exclusions expressed in code (a topic that rules a video out), covering ~85% of feed and history together.
- **Volume isn't preference.** A lane can be overconsumed (no extra prominence) or aspirational (a reason for the backlog to exist).
- An LLM drafts from the data; the owner decides.

### What the classifier sees

- Text only: title, channel, duration, plus description, tags, category and topic categories from the **YouTube Data API**, called by the Worker with an API key (free quota: 10,000 units/day; `videos.list` costs 1 unit per 50 videos). The lookups never touch my signed-in session.
- **Data API survey (Nov 2026):** beyond what the model already sees (title, channel and the first sentence of its description, length, tags, description), nothing is worth adding yet. Wikipedia topic categories are coarse and often wrong ("Society" for a stock analysis); audio language, live details and statistics are metadata that no behaviour reads yet. (For later: a channel's `UULF` playlist lists only its long-form uploads, for 1 unit.)
- **No thumbnails.** For lanes, shelf life and listen they carry little the text doesn't, at the cost of image tokens and multi-second latency. Revisit only if accuracy measurably suffers.
- YouTube's own category is creator-chosen and coarse (market commentary and an AI-IPO analysis are both "Education"): an input feature, never the classifier.

### Where it runs

- A small **Cloudflare Worker** (mine, free tier) classifies each new upload **as it is published**, so the feed is ready when I open it. Answers are cached per video in D1, forever. Lanes, shelf life and listen are derived on every read, so a logic change applies at once.
  - **Push, not polling:** the userscript sends my subscription list (again when it changes); the Worker subscribes to each channel's upload notifications (YouTube's official [WebSub push](https://developers.google.com/youtube/data/guides/push_notifications)). An upload calls the Worker, which enriches that one video via the Data API and asks the decision model. Shorts and music (category 10) are skipped. A small daily job renews the subscriptions, which expire after a few days.
  - **No backfill.** Only uploads from deployment onwards; older rows age out of the feed within a day. Notifications for edited titles or descriptions are ignored for videos already classified.
  - **Saved playlists are classified on the way in,** through Keep or a migration. The only on-demand case left is a video kept from outside my subscriptions.
  - **Load:** ~110 long-form uploads a day, spread across the day: ~310k tokens, well within Gemini's free tier.
- **The decision model is swappable:** Jev's System One request (a `state` plus typed `noul` / `choice` / `score` questions) is shared by Jev 1.13 ($0.042 per 1M input tokens; on OpenCode Console, with a free variant for a limited time), Gemini Decision 1 and GPT-6 Luna Decision (same OpenCode endpoint), and Clef. Clef-flash runs on Workers AI through the binding (no extra key; up to 64 questions per request; ~1.2M free tokens/day).
- **Default: Gemini Decision 1**, chosen by test (Nov 2026): on 25 reviewed videos it was fully right on 22, Clef on 9, and it was less often unsure (6% of answers between 0.3 and 0.7, against Clef's 10–11%). ~2,850 input tokens per video, so ~100 new videos a day fit the free tier (10,000 requests a day; 50,000 tokens a minute, so bulk jobs are throttled). Clef stays a drop-in alternative.
- On-device (Pixel TPU via AICore / Gemini Nano) is unreachable from a web page; not pursued.

## Backlog structure

| Playlist | Role |
|---|---|
| **Watch Later** | Manual escape hatch: putting something there overrules the classifier, so the machine never classifies, orders or touches it. Shown as text rows in YouTube's order, no chips. Its current contents are migrated once. |
| **Lane playlists** | Machine-curated, one per lane. Fed by **Keep**. Tracked by playlist ID; visibly marked as machine-curated. |
| **Manual playlists** | Purpose-built by me (e.g. music); never touched by the machine. |
| **Legacy playlists** (info / infotainment / entertainment) | Sorting is ruined; migrated once into lanes, some time later. |

- **Keep** saves to the lane whose strongest topic is most probable. When no lane matches, it opens the lane picker and I choose. Watch Later is never chosen by the machine. Whether probabilities from separate questions compare well enough for this is untested.
- **Shelf life never routes.** A video ages, so a gate at Keep time would eventually contradict itself. It only orders the backlog and drives the stale review.
- **Migrations re-triage.** Watch Later and legacy items go through the same gate. Items with a lane are moved to it without asking (I move one back when I get to it); stale ones are proposed for removal, with one approval from me for the whole batch.
- Classification alone doesn't fix "the back never gets watched": lane playlists will grow too. The backlog view must order for consumption: **soonest to go stale first** (shelf life minus age), evergreen last and oldest-saved first among them; evergreen can always wait.
- **No channel-avatar strip, no playlist header thumbnails** on the pages we render.
- **Rows don't show their lane:** it would add a wrapping line, and under a lane chip it repeats the chip. The lane shows in Keep's toast and lane picker.
- **A row not classified yet** (an upload from the last minute, or one the model failed on) says "sorting…" in its meta line and appears under All only; Keep classifies it on the spot.
- **Typed intent results** are newest first (so what I've already triaged sinks, with nothing to track), and combine with the lane and listen chips.
- **Chips** show counts. An **Other** chip holds videos no lane matched.
- **Remove from a playlist** is at the bottom of Keep's lane picker, opened from the filled bookmark on a kept row.
- **Each lane playlist can be filtered and sorted:** filters for listen and shelf life (weeks, months, evergreen); sort by soonest stale (default), recently added, oldest added or length. Rows don't show their shelf life.
- **Stale videos in a lane** are offered by a banner ("N videos have gone stale · Review") that opens one review sheet, everything ticked; I untick what I still want, then remove the rest in one tap.
- **Nothing is hidden or removed for being watched.** Watch progress isn't proof (I sometimes fall asleep with a video playing), so rows keep the progress bar and finished ones are dimmed. I remove videos myself; the machine never does.

### Suggestions: auto-fill with a human in the loop (deferred)

*Deferred (Nov 2026): designed after Keep has been in use for a while. Their candidates are uploads triage never loaded, which means classifying roughly everything my subscriptions post; how to find them cheaply is unresolved. The intent below stands.*

Keep is the main way in. Alongside it, the machine proposes additions in a batch I approve, without becoming a recommender.

- **Only from my subscriptions.** Never the catalog, not even Liked videos: it routes what I chose to follow; it doesn't recommend.
- **Same gate as Keep:** long shelf life (months or evergreen) and a confident lane match.
- **Only what triage never reached.** A row that was on screen and not kept was a decision; it isn't proposed again. We render the list, so recording what was shown is cheap.
- **One weekly review:** plain rows, approve all or untick some. Nothing enters a lane without it.
- **No cap at first;** the backlog view shows each lane's size and unwatched count, and I calibrate from what happens. These defaults are a starting point, not settled.
- **To explore if lanes outgrow my watching:** suggestions only replace what I've watched. Each review, a lane gets at most as many suggestions as I watched from it since the last one. Only Keep grows the backlog, and the cap follows my watching with no number to tune.

## Account safety

YouTube's Terms forbid automated access without permission; the official Data API is that permission. Enforcement targets bot-like patterns (volume, speed, regularity). Therefore:

- **Reads for classification** go through the Data API with an API key, not the session.
- **Single writes I trigger** (Keep) use the page's own save action, the same thing YouTube's Save button does.
- **Bulk writes** (migrations) use the official API with OAuth, throttled (~200 inserts/day at 50 units each). The API can't read or change Watch Later, so removals from it go through the session (pace decided at migration). No OAuth client exists yet; it's created when migration starts.

## Surface

A **userscript on m.youtube.com** (Vivaldi + Tampermonkey on Android, installable as a home-screen web app).

- It runs inside the signed-in session, so Ask, Watch Later and private playlists work with no OAuth and no keys.
- **Split by what needs the session.** Only Ask, reading Watch Later and private playlists, Keep, and rendering must run on `m.youtube.com`; a userscript is the lightest thing that can. Everything else (metadata, classification, cache) lives in the Worker, which the page can reach directly: `m.youtube.com` sets no `connect-src` CSP, so a CORS-enabled Worker needs no special grants.
- **Fallback:** if userscripts stop working in the browser, the same code becomes an MV3 extension content script. A separate site or native app can't call Ask or read Watch Later, which rules them out.
- **Rejected:** patched or modded clients (ReVanced etc.: ban risk to the main account); YouTube Lite (no Jump Ahead); WebView wrapper apps (Google blocks sign-in in WebViews); Chrome (no extensions on Android); yt-dlp and third-party frontends (lose Premium; see the alignment principle).

### Rendering: our own lists, YouTube's own data

**List pages** (subscriptions, Watch Later, playlists) **are rendered by us**; everything else, Home included, stays YouTube's page, decorated.

- **Why:** the backlog needs things YouTube's list page can't do: its own order (soonest to go stale first), filtering a whole 100+ item playlist. On a decorated page, hiding most rows only makes YouTube's infinite scroll load more on its own schedule. Owning the list also retires the hide-then-transform machinery (mutation observers, rescans, the old-format flash).
- **How:** fetch with `innertube('browse')` and follow continuations, the same requests the page makes when scrolling. They return the renderers the adapters already map (`playlistVideoRenderer`, `videoWithContextRenderer`). Mount on the platform's `navigatesuccess` event (fires ~50 ms after every in-app navigation, back included, before YouTube's own `state-navigateend` at ~550 ms); a top-level node survives navigation. YouTube's list is hidden underneath.
- **Cost:** playlists page at 20 items (~330 ms each, sequential: each response carries the next token). A 170-item playlist loads in ~3 s, a 314-item one in ~5.5 s. So rows stream in as pages arrive, and lists are cached on the device: instant on reopen, refreshed in the background. A full load is the same traffic as scrolling to the bottom, so no account-safety concern.
- **Lost, rebuilt:** the native ⋮ menu (Save to Watch later, Save to playlist, Hide). Keep's bookmark replaces it: its lane picker includes Watch Later. Hide is dropped. "Remove from playlist" is one innertube call; where it sits on a playlist row is open.
- Innertube calls must send `x-goog-authuser` (the page's `SESSION_INDEX`); otherwise they silently hit the device's first Google account.
