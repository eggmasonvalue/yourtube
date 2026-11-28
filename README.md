# YourTube

**Keep your intent between opening YouTube and pressing play.**

You open YouTube for something specific; seconds later the thumbnails and the algorithm have chosen for you. YourTube is a userscript for `m.youtube.com` that turns your feeds into a calm, text-only list you triage by *reading*, with YouTube's own Gemini **Ask** one tap away for a summary before you commit. Watching always happens in the official YouTube app, so Premium (no ads, Jump Ahead) keeps working.

It is personal software: built for one person's daily routine, shared as-is. Why it exists and what it deliberately isn't: [docs/PRODUCT.md](docs/PRODUCT.md).

## What it does

- **Text rows instead of cards** on Home, Subscriptions, Watch Later and playlists: title, channel, duration, views and age. Mixes and playlist cards become rows too.
- **No distractions:** thumbnails, Shorts (including the tab), posts, mini-games and promo shelves are hidden. YouTube's own cards never flash before their row is ready.
- **Watch progress** as a thin red bar on the row's divider; finished videos are dimmed.
- **✦ Ask** on every video row opens a sheet with YouTube's Gemini summary, follow-up suggestions and free-text questions. Nothing loads until you tap, and the player never starts.
- **Timestamps in answers** open the video in the app at that moment.
- **Tap a title** (or *Watch on YouTube*) to open it in the official app: videos, Mixes and playlists alike.
- **⋮** opens YouTube's own menu for the video (Save to Watch Later, etc.).
- Google Sans Flex throughout; follows the system light/dark theme.
- **Installable** as a home-screen web app that starts on Subscriptions.

## How it works

Everything runs inside your signed-in `m.youtube.com` page. There is no server and no API key.

- **Feed:** each card's renderer data (`el.data`) is read and re-rendered as a text row; YouTube's own card stays hidden underneath.
- **Ask:** the same calls YouTube's watch page makes, made from the feed instead:
  1. `POST /youtubei/v1/next` for the video returns the Ask panel: suggested prompts with continuation tokens, and a token for free-text questions.
  2. `POST /youtubei/v1/get_panel` with the *Summarize* continuation returns the answer as Markdown.
  3. Follow-ups send the question with `previousClientMessageId` to keep the thread.
- **Opening the app:** links use the YouTube app's own `vnd.youtube:///…` scheme, the one form that also works from an installed web app.
- **Web app:** YouTube ships no manifest on mobile, so the script supplies one with a generated icon.

## Install (Android)

1. A Chromium browser with extension support. Developed on **Vivaldi**; Chrome for Android has no extensions.
2. Install **[Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)** and, on recent Chromium, enable *Allow user scripts* in its extension details.
3. Open **[`src/yourtube.user.js`](https://raw.githubusercontent.com/eggmasonvalue/yourtube/main/src/yourtube.user.js)** and tap **Install**.
4. Sign in on `m.youtube.com` and reload.
5. Optional: browser menu → **Add to home screen**.

Ask needs a signed-in account where YouTube's Ask feature is available (look for ✦ Ask under any video). Premium is optional but is the point of handing playback to the app.

## Roadmap

**Lanes and a backlog you can trust.** A decision model (Clef / Gemini Decision) labels each video by topic, format and shelf life, so a feed can be narrowed to one lane or a typed intent. **Keep** saves long-lived videos into machine-curated lane playlists for downtime; short-lived ones stay in the daily feed. Design and open questions: [docs/PRODUCT.md](docs/PRODUCT.md).

## Development

Tools for driving the browser on a connected phone over the Chrome DevTools Protocol (`adb` + Node ≥ 22):

```sh
adb forward tcp:9333 localabstract:chrome_devtools_remote   # or chrome_devtools_remote_<pid>
node tools/cdp.mjs --file src/yourtube.user.js               # hot-inject the script into the open tab
node tools/cdp.mjs 'document.title'                          # evaluate anything in the page
node tools/cdp.mjs --method Page.getInstallabilityErrors '{}' # raw CDP call
node tools/cdp-net.mjs 15 out.json '<expr>'                  # run expr and capture /youtubei traffic
node tools/serve.mjs                                         # serve src/ to the phone over adb reverse
```

List the devtools sockets with `adb shell grep -a devtools /proc/net/unix`; `curl localhost:9333/json/version` shows which browser owns one.

### Worker (classifier)

`worker/` is a Cloudflare Worker (free tier) that classifies your subscriptions' uploads ahead of time; see [PRODUCT.md](docs/PRODUCT.md#where-it-runs). It imports your topics and lanes from `personal/topics.mjs` (not in this repo: write your own, same shape as `topics`, `lanes`, `unless`).

```sh
cd worker
npx wrangler login
npx wrangler d1 create yourtube                    # put the id in wrangler.jsonc
npx wrangler d1 execute yourtube --remote --file schema.sql
npx wrangler secret put YT_KEY                     # YouTube Data API key
npx wrangler secret put GEMINI_KEY                 # Gemini API key (Decisions API)
npx wrangler secret put TOKEN                      # any random string; the userscript sends it
npx wrangler deploy
npx wrangler dev --test-scheduled                  # local run; secrets in worker/.dev.vars; trigger the cron at /__scheduled
```

## Caveats

- Built on YouTube's **internal, undocumented** web API and page structure. It will break when they change; fixes are usually small.
- It only makes requests you trigger, as the signed-in you, at human pace. Keep it that way: the account matters more than the script.
- Not affiliated with or endorsed by YouTube or Google.

## License

[MIT](LICENSE)
