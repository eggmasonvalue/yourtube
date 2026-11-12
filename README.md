# YourTube

**Triage YouTube by reading, not by thumbnail.**

A userscript for `m.youtube.com` that turns your Home, Subscriptions and Watch Later feeds into a calm text list — title, channel, duration, views, age, watch progress — and puts a **✦ Ask Gemini** button on every row. Tap it to read a Gemini summary of the video and ask follow-ups *before* deciding whether it is worth your time. Tap the title to watch it in the official YouTube app.

No thumbnails. No Shorts. No autoplay. No backend, no API keys, no patched apps.

## How it works

YouTube already has an **Ask** button (Gemini) under the player on the watch page. YourTube calls the same thing from the feed:

1. `POST /youtubei/v1/next` for the video — the response carries the Ask panel (`PAyouchat`): suggested prompts, each with a continuation token, plus the composer token for free-text questions.
2. `POST /youtubei/v1/get_panel` with the *Summarize the video* continuation returns the answer as Markdown, with timestamps and follow-up suggestions.
3. Follow-ups send `userInputText` plus `previousClientMessageId` to keep the thread.

Both calls are made from inside your signed-in page, so the answers are exactly what YouTube's own Ask feature would give you. The player is never loaded, so nothing autoplays.

Everything else is presentation: feed cards are read from YouTube's own renderer data (`el.data`) and re-rendered as text rows; thumbnails, Shorts, posts and mini-games are hidden with CSS.

### Features

- Text-only rows for Home, Subscriptions, Watch Later and playlists, with watch progress as a thin red bar (finished videos dimmed); Mixes and playlist cards become rows too
- No flash of YouTube's own cards: they stay hidden until their text row is ready
- ✦ **Ask Gemini** sheet: auto-summary, follow-up chips, free-text questions
- Timestamps in answers are pills that open the video **at that moment** in the YouTube app
- Title tap / **Watch on YouTube** opens the official app (keeps Premium features like Jump Ahead) — videos, Mixes and playlists alike, also from the installed web app (via the app's `vnd.youtube:` scheme)
- ⋮ opens YouTube's own menu for the video (save to Watch Later, etc.)
- Google Sans Flex throughout; follows YouTube's light/dark theme
- Installable as a standalone web app (the script supplies the missing web-app manifest)

## Install (Android)

1. Use a Chromium browser that supports extensions — e.g. **Vivaldi** (8.2+), Edge, Quetta, Lemur.
2. Install **[Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)**. On recent Chromium, enable *Allow user scripts* in the extension's details.
3. Open **[`src/yourtube.user.js` (raw)](https://raw.githubusercontent.com/eggmasonvalue/yourtube/main/src/yourtube.user.js)** and tap **Install**.
4. Sign in on `m.youtube.com` and reload.
5. Optional: browser menu → **Install app** / **Add to home screen**.

Requires a signed-in account in a region where YouTube's Ask feature is available (check for the ✦ Ask button under any video).

## Development

The repo includes small tools for driving the browser on a USB-connected phone via the Chrome DevTools Protocol (`adb` + Node ≥ 22):

```sh
adb forward tcp:9333 localabstract:chrome_devtools_remote_<pid>   # browser's devtools socket
node tools/cdp.mjs --file src/yourtube.user.js                     # hot-inject the script into the open tab
node tools/cdp.mjs 'document.title'                                # evaluate anything in the page
node tools/cdp.mjs --method Page.getInstallabilityErrors '{}'      # raw CDP call
node tools/cdp-net.mjs 15 out.json '<expr>'                        # run expr and capture /youtubei traffic
node tools/serve.mjs                                               # serve src/ to the phone over adb reverse
```

Find the browser's devtools socket with `adb shell cat /proc/net/unix | grep devtools` and match the PID with `adb shell pidof <package>`.

## Caveats

- This relies on YouTube's **internal, undocumented** web API and page structure. It will break when YouTube changes them; fixes are usually small.
- Not affiliated with or endorsed by YouTube or Google.

## Roadmap

- Sub-feeds: classify feed items with a decision model (e.g. Jev / Clef) into topics such as *deep dives*, *news*, *favourite creators*, *likely bait*.

## License

[MIT](LICENSE)
