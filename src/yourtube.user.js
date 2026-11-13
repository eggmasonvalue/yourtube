// ==UserScript==
// @name         YourTube
// @namespace    yourtube
// @version      0.3.9
// @description  Text-first YouTube feed with on-demand Gemini "Ask" per video.
// @author       eggmasonvalue
// @license      MIT
// @homepageURL  https://github.com/eggmasonvalue/yourtube
// @supportURL   https://github.com/eggmasonvalue/yourtube/issues
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// @inject-into  page
// @updateURL    https://raw.githubusercontent.com/eggmasonvalue/yourtube/main/src/yourtube.user.js
// @downloadURL  https://raw.githubusercontent.com/eggmasonvalue/yourtube/main/src/yourtube.user.js
// ==/UserScript==

(() => {
  'use strict';
  window.__yourtube?.destroy();
  const cleanups = [];

  // ── DOM helpers (the page enforces Trusted Types: no innerHTML) ─────────────
  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter(k => k != null && k !== false));
    return el;
  };
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.append(...kids);
    return el;
  };
  const icon = (d, cls = '') => svg('svg', { viewBox: '0 0 24 24', class: `yt-icon ${cls}` }, svg('path', { d }));
  const GEMINI = [['0', '#4285f4'], ['.55', '#9b72cb'], ['1', '#d96570']]; // gradient stops, shared by CSS/SVG/canvas
  const ICONS = {
    spark: 'M12 1C12 7 17 12 23 12C17 12 12 17 12 23C12 17 7 12 1 12C7 12 12 7 12 1Z',
    send: 'M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a1 1 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    play: 'M8 5.14v13.72a1 1 0 001.5.86l11-6.86a1 1 0 000-1.72l-11-6.86A1 1 0 008 5.14z',
    more: 'M12 8a2 2 0 100-4 2 2 0 000 4zm0 2a2 2 0 100 4 2 2 0 000-4zm0 6a2 2 0 100 4 2 2 0 000-4z',
  };

  // ── YouTube data helpers ────────────────────────────────────────────────────
  const text = x => x == null ? '' : typeof x === 'string' ? x
    : x.content ?? x.simpleText ?? x.runs?.map(r => r.text).join('') ?? '';
  const findAll = (o, pred, acc = []) => {
    if (o && typeof o === 'object') {
      if (pred(o)) acc.push(o);
      for (const v of Object.values(o)) findAll(v, pred, acc);
    }
    return acc;
  };
  const isDuration = s => /^(\d+:)?\d{1,2}:\d{2}$/.test(s);
  const seconds = ts => ts.split(':').reduce((acc, n) => acc * 60 + +n, 0);
  // vnd.youtube: is the YouTube app's own scheme. Unlike intent:// URLs, installed web apps (PWA) allow it,
  // and the app accepts any youtube.com path after it: videos (&t=), mixes (&list=), playlist pages.
  // Keep the host empty (vnd.youtube:///path): with a host, installed web apps silently drop the navigation.
  const openInApp = path => {
    location.href = `vnd.youtube://${path}`;
  };

  // Innertube: same-origin calls with the signed-in session.
  const innertube = async (endpoint, body) => {
    const sapisid = document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    const ts = Math.floor(Date.now() / 1000);
    const digest = sapisid && await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
    const hash = digest && [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-youtube-client-name': String(ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME')),
        'x-youtube-client-version': ytcfg.get('INNERTUBE_CLIENT_VERSION'),
        'x-origin': location.origin,
        ...(hash && { authorization: `SAPISIDHASH ${ts}_${hash}` }),
      },
      body: JSON.stringify({ context: ytcfg.get('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
    return res.json();
  };

  // ── Feed cards → text rows ──────────────────────────────────────────────────
  // Each adapter maps a card's renderer data to { id, title, parts[], length, url?, playlist? }.
  // Searches are scoped to small subtrees: the full data includes large menu/command objects.
  const adapters = {
    'YT-LOCKUP-VIEW-MODEL': d => {
      const playlist = d.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST';
      if (!playlist && d.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
      const meta = d.metadata?.lockupMetadataViewModel;
      const badges = findAll(d.contentImage, o => o.thumbnailBadgeViewModel).map(o => text(o.thumbnailBadgeViewModel.text));
      return {
        id: d.contentId,
        playlist,
        title: text(meta?.title),
        parts: findAll(meta?.metadata, o => Array.isArray(o.metadataParts))
          .flatMap(r => r.metadataParts.map(p => text(p.text))),
        length: playlist ? badges[0] : badges.find(isDuration), // "Mix" / "25 videos" for playlists
        url: playlist && (d.rendererContext?.commandContext?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url
          ?? `/playlist?list=${d.contentId}`),
      };
    },
    'YTM-VIDEO-WITH-CONTEXT-RENDERER': d => ({
      id: d.videoId,
      title: text(d.headline),
      parts: [text(d.shortBylineText), text(d.shortViewCountText), text(d.publishedTimeText)],
      length: text(d.lengthText),
    }),
    'YTM-PLAYLIST-VIDEO-RENDERER': d => ({
      id: d.videoId,
      title: text(d.title),
      parts: [text(d.shortBylineText), ...text(d.videoInfo).split(' • ')],
      length: text(d.lengthText),
    }),
  };
  adapters['YTM-COMPACT-VIDEO-RENDERER'] = adapters['YTM-VIDEO-WITH-CONTEXT-RENDERER'];
  const CARD_SEL = Object.keys(adapters).map(t => t.toLowerCase()).join(',');

  // Progress lives in the thumbnail overlays: contentImage (lockups) or thumbnailOverlays (older renderers).
  const progressOf = d => {
    const p = findAll(d.contentImage ?? d.thumbnailOverlays, o => typeof o.percentDurationWatched === 'number' || typeof o.startPercent === 'number')[0];
    return p ? (p.percentDurationWatched ?? p.startPercent) : 0;
  };

  const toItem = el => {
    const v = adapters[el.tagName]?.(el.data);
    if (!v?.id || !v.title) return null;
    const [channel, ...rest] = v.parts.filter(Boolean);
    return {
      ...v, channel, url: v.url || `/watch?v=${v.id}`,
      meta: [v.length, ...rest].filter(Boolean), progress: progressOf(el.data),
    };
  };

  // Watch progress is drawn as a red bar on the row's bottom divider (CSS var --p); finished videos are dimmed.
  const row = (el, v) => h('div', {
    class: v.progress >= 95 ? 'yt-row yt-done' : 'yt-row', 'data-id': v.id,
    style: v.progress > 0 && `--p:${Math.round(v.progress)}%`,
  },
    h('div', { class: 'yt-main', onclick: () => openInApp(v.url) },
      h('div', { class: 'yt-title' }, v.title),
      h('div', { class: 'yt-meta' },
        h('span', { class: 'yt-channel' }, v.channel ?? ''),
        ...v.meta.map(m => h('span', {}, m)))),
    !v.playlist && h('button', { class: 'yt-ask', 'aria-label': 'Ask Gemini', onclick: () => ask.open(v) }, icon(ICONS.spark, 'yt-gemini')),
    h('button', {
      class: 'yt-more', 'aria-label': 'More actions',
      onclick: () => el.querySelector('button[aria-label*="ction"], button[aria-label*="More"]')?.click(),
    }, icon(ICONS.more)));

  // Cards render hidden (see CSS) until they become a row; non-video cards are marked native and shown as-is.
  // Each card is processed once per data object, so rescans (every mutation/scroll frame) cost ~nothing.
  const seen = new WeakMap(); // card element → { data it was rendered from, its row }
  const transform = el => {
    const last = seen.get(el);
    if (last?.data === el.data && (last.row ? last.row.parentNode === el : el.classList.contains('yt-native'))) return;
    last?.row?.remove();
    const v = toItem(el);
    el.classList.toggle('yt-native', !v);
    el.classList.toggle('yt-x', !!v);
    const r = v && el.appendChild(row(el, v));
    seen.set(el, { data: el.data, row: r });
  };

  // ── Ask sheet: YouTube's own Gemini "Ask about this video", fetched off-page ─
  const ask = (() => {
    const sessions = new Map(); // videoId → { composer, lastId, log: [{role, text, error}], chips, pending }
    let wrap, body, chipsBox, input, current;

    // Timestamps (optionally a range, optionally parenthesised) become one pill that opens the app there.
    const TS = String.raw`(?:\d+:)?\d{1,2}:\d{2}`;
    const TS_RE = new RegExp(String.raw`\(?\b(${TS})(?:\s*[-–]\s*(${TS}))?\b\)?`, 'g');
    const inline = (s, id) => {
      const out = [];
      for (const part of s.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/)) {
        if (/^\*\*.+\*\*$/.test(part)) out.push(h('b', {}, ...inline(part.slice(2, -2), id)));
        else if (/^\*.+\*$/.test(part)) out.push(h('i', {}, ...inline(part.slice(1, -1), id)));
        else {
          let last = 0;
          for (const m of part.matchAll(TS_RE)) {
            out.push(part.slice(last, m.index).replace(/\s+$/, ' '),
              h('a', { class: 'yt-ts', onclick: () => openInApp(`/watch?v=${id}&t=${seconds(m[1])}`) }, icon(ICONS.play), m[2] ? `${m[1]}–${m[2]}` : m[1]));
            last = m.index + m[0].length;
          }
          out.push(part.slice(last));
        }
      }
      return out;
    };
    const markdown = (md, id) => md.split('\n').filter(l => l.trim()).map(line => {
      const heading = line.match(/^#{1,6}\s+(.*)/);
      if (heading) return h('div', { class: 'yt-h' }, ...inline(heading[1], id));
      const bullet = line.match(/^\s*[*-]\s+(.*)/);
      if (bullet) return h('div', { class: 'yt-li' }, ...inline(bullet[1], id));
      return h('p', {}, ...inline(line, id));
    });

    const shimmer = () => h('div', { class: 'yt-shimmer' }, ...[92, 100, 76, 88, 54].map(w => h('i', { style: `width:${w}%` })));

    const render = () => {
      const s = sessions.get(current.id);
      body.replaceChildren(...s.log.map(m => m.role === 'user'
        ? h('div', { class: 'yt-user' }, m.text)
        : h('div', { class: `yt-bot${m.error ? ' yt-err' : ''}` }, ...markdown(m.text, current.id))));
      if (s.pending) body.append(shimmer());
      else if (s.log.some(m => m.role === 'bot' && !m.error)) body.append(h('div', { class: 'yt-disclaimer' }, 'AI can make mistakes, so double-check it.'));
      chipsBox.replaceChildren(...(s.pending ? [] : s.chips).map(c =>
        h('button', { class: 'yt-chip', onclick: () => send(c.continuation, c.label) }, icon(ICONS.spark, 'yt-gemini'), c.label)));
      const lastUser = [...body.querySelectorAll('.yt-user')].at(-1);
      (lastUser ?? body.firstElementChild)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const chipsIn = o => findAll(o, c => typeof c.continuation === 'string' && text(c.text))
      .map(c => ({ label: text(c.text), continuation: c.continuation }))
      .filter((c, i, all) => all.findIndex(x => x.label === c.label) === i);
    const composerToken = o => findAll(o, x => x.chatInputViewModel)[0]
      ?.chatInputViewModel.sendUserQueryCommand?.innertubeCommand?.continuationCommand?.token;

    const send = async (continuation, label, typed = false) => {
      const id = current.id, s = sessions.get(id);
      const clientMessageId = `youchat-${Date.now()}`;
      s.log.push({ role: 'user', text: label });
      s.pending = true;
      render();
      try {
        const res = await innertube('get_panel', {
          continuation,
          formData: { inputComposerFormData: {
            clientMessageId, playerOffsetMs: '0',
            ...(typed && { userInputText: label }),
            ...(s.lastId && { previousClientMessageId: s.lastId }),
          } },
        });
        const answer = findAll(res.onResponseReceivedCommand ?? res, o => o.youChatItemViewModel)
          .map(o => text(o.youChatItemViewModel.text)).filter(Boolean).join('\n\n');
        s.log.push({ role: 'bot', text: answer || 'No answer returned.', error: !answer });
        s.chips = chipsIn(res);
        s.lastId = clientMessageId;
        s.composer = composerToken(res) ?? s.composer;
      } catch (e) {
        s.log.push({ role: 'bot', text: `Failed: ${e.message}`, error: true });
      }
      s.pending = false;
      if (current?.id === id) render();
    };

    const start = async v => {
      const s = { log: [], chips: [], pending: true };
      sessions.set(v.id, s);
      render();
      try {
        const next = await innertube('next', { videoId: v.id });
        const panel = findAll(next, o => o.panelIdentifier === 'PAyouchat' && o.content)[0];
        if (!panel) throw new Error('Ask is not available for this video');
        s.chips = chipsIn(panel);
        s.composer = composerToken(panel);
        const summarize = s.chips.find(c => /summar/i.test(c.label));
        if (summarize) return send(summarize.continuation, summarize.label);
      } catch (e) {
        s.log.push({ role: 'bot', text: `Failed: ${e.message}`, error: true });
      }
      s.pending = false;
      render();
    };

    // Vivaldi overlays the keyboard on the layout viewport; pin the sheet to the *visual* viewport instead.
    const fit = () => {
      if (!wrap) return;
      const vv = visualViewport;
      wrap.style.top = `${vv.offsetTop}px`;
      wrap.style.height = `${vv.height}px`;
    };
    visualViewport.addEventListener('resize', fit);
    visualViewport.addEventListener('scroll', fit);
    cleanups.push(() => { visualViewport.removeEventListener('resize', fit); visualViewport.removeEventListener('scroll', fit); });

    const close = () => { wrap?.remove(); wrap = current = null; document.documentElement.classList.remove('yt-locked'); };

    const open = v => {
      close();
      current = v;
      const submit = e => {
        e.preventDefault();
        const q = input.value.trim(), s = sessions.get(v.id);
        if (!q || s.pending) return;
        if (!s.composer) return s.log.push({ role: 'bot', text: 'Follow-up input unavailable for this video.', error: true }), render();
        input.value = '';
        input.style.height = '';
        send(s.composer, q, true);
      };
      wrap = h('div', { class: 'yt-sheet-wrap', onclick: e => e.target === wrap && close() },
        h('div', { class: 'yt-sheet' },
          h('div', { class: 'yt-handle' }),
          h('div', { class: 'yt-sheet-head' },
            h('div', { class: 'yt-sheet-title' },
              h('div', { class: 'yt-overline' }, icon(ICONS.spark, 'yt-gemini'), 'Ask Gemini'),
              h('div', { class: 'yt-sheet-video' }, v.title),
              h('div', { class: 'yt-meta' }, [v.channel, ...v.meta].filter(Boolean).join(' · '))),
            h('button', { class: 'yt-icon-btn', 'aria-label': 'Close', onclick: close }, icon(ICONS.close))),
          h('button', { class: 'yt-watch', onclick: () => openInApp(v.url) }, icon(ICONS.play), 'Watch on YouTube'),
          body = h('div', { class: 'yt-sheet-body' }),
          chipsBox = h('div', { class: 'yt-chips' }),
          h('form', { class: 'yt-composer', onsubmit: submit },
            // A textarea (not <input>) so Chromium doesn't overlay its autofill accessory bar above the keyboard.
            input = h('textarea', {
              rows: 1, placeholder: 'Ask about this video', enterkeyhint: 'send', maxlength: 500,
              autocomplete: 'off', autocorrect: 'on', spellcheck: 'true',
              oninput: () => { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; },
              onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) submit(e); },
            }),
            h('button', { type: 'submit', class: 'yt-send', 'aria-label': 'Send' }, icon(ICONS.send)))));
      document.body.append(wrap);
      document.documentElement.classList.add('yt-locked');
      fit();
      sessions.has(v.id) ? render() : start(v);
    };

    return { open, close };
  })();

  // ── Installable web app: YouTube ships no manifest, so we provide one ──────
  const installable = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--yt-bg').trim(); // splash + icon tile follow the theme
    // YouTube-like mark (red rounded rect + white play) with a small Gemini spark, drawn in the maskable safe zone.
    const png = size => {
      const c = h('canvas', { width: size, height: size }), g = c.getContext('2d'), u = size / 100;
      g.fillStyle = bg; // tile matches the splash/theme so there is no light square in dark mode
      g.fillRect(0, 0, size, size);
      g.fillStyle = '#ff0033';
      g.beginPath(); g.roundRect(22 * u, 30 * u, 56 * u, 40 * u, 11 * u); g.fill();
      g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = 3 * u;
      g.beginPath(); g.moveTo(44 * u, 41 * u); g.lineTo(44 * u, 59 * u); g.lineTo(59 * u, 50 * u); g.closePath(); g.fill(); g.stroke();
      const spark = new Path2D(ICONS.spark), k = (16 * u) / 22;
      const grad = g.createLinearGradient(1, 1, 23, 23); // in the spark's own 24-unit space
      for (const [o, c] of GEMINI) grad.addColorStop(+o, c);
      g.setTransform(k, 0, 0, k, 73 * u - 12 * k, 33 * u - 12 * k);
      g.lineWidth = 5; g.stroke(spark);      // white halo separates the spark from the red
      g.fillStyle = grad;
      g.fill(spark);
      return c.toDataURL('image/png');
    };
    const manifest = {
      name: 'YourTube', short_name: 'YourTube', id: '/?yourtube',
      start_url: `${location.origin}/feed/subscriptions`, scope: `${location.origin}/`,
      display: 'standalone', background_color: bg, theme_color: bg,
      icons: [
        { src: png(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: png(512), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
    const link = h('link', { rel: 'manifest', href: url });
    document.querySelectorAll('link[rel=manifest]').forEach(l => l.remove());
    document.head.append(link);
    cleanups.push(() => { link.remove(); URL.revokeObjectURL(url); });
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wdth,wght@6..144,25..151,1..1000&display=swap');
    :root {
      --yt-font: 'Google Sans Flex', 'Google Sans', Roboto, Arial, sans-serif;
      --yt-fg:#1f1f1f; --yt-mute:#5f6368; --yt-bg:#fff; --yt-surface:#f0f4f9; --yt-line:#e3e3e3; --yt-accent:#0b57d0;
      --yt-gemini: linear-gradient(74deg, ${GEMINI.map(([o, c]) => `${c} ${o * 100}%`)});
    }
    html:is([dark], [darker-dark-theme]) { /* m.youtube.com now uses darker-dark-theme */
      --yt-fg:#e3e3e3; --yt-mute:#9aa0a6; --yt-bg:#131314; --yt-surface:#1e1f20; --yt-line:#2d2f31; --yt-accent:#a8c7fa;
    }
    html, body, ytm-app, ytm-app * { font-family: var(--yt-font) !important; }

    /* distraction removal */
    ytm-rich-section-renderer, ytm-reel-shelf-renderer, ytm-shorts-lockup-view-model,
    ytm-rich-item-renderer:has(ytm-shorts-lockup-view-model), ytm-backstage-post-thread-renderer,
    mini-game-card-view-model, ytm-statement-banner-renderer,
    ytm-pivot-bar-item-renderer:has(.pivot-shorts) { display:none !important; }
    yt-thumbnail-view-model, .media-item-thumbnail-container, ytm-thumbnail-cover { display:none !important; }

    /* shared */
    .yt-icon { width:20px; height:20px; fill:currentColor; flex:none; }
    .yt-gemini { fill:url(#yt-gemini-grad); }

    /* text rows */
    .yt-x { margin:0 !important; padding:0 !important; }
    /* Hide YouTube's own card from the first frame, so it never flashes before its row is built. */
    :is(${CARD_SEL}):not(.yt-native) > :not(.yt-row) { display:none !important; }
    ytm-rich-item-renderer:has(.yt-x) { margin:0 !important; padding:0 !important; }
    .yt-row { display:flex; gap:4px; align-items:center; padding:14px 8px 14px 16px;
      border-bottom:1px solid var(--yt-line); color:var(--yt-fg); font:14px/1.4 var(--yt-font);
      background:linear-gradient(#f03, #f03) left bottom / var(--p, 0%) 2px no-repeat border-box; }
    .yt-done .yt-main { opacity:.5; }
    .yt-main { flex:1; min-width:0; }
    .yt-title { font-size:15.5px; font-weight:500; font-variation-settings:'opsz' 18; letter-spacing:-.005em;
      display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
    .yt-meta { color:var(--yt-mute); font-size:12.5px; margin-top:4px; font-stretch:95%; }
    .yt-meta span + span::before { content:' · '; }
    .yt-channel { color:var(--yt-fg); font-weight:500; opacity:.8; }
    .yt-row button { flex:none; border:0; background:none; color:var(--yt-mute); padding:0; display:grid; place-items:center; }
    .yt-row .yt-ask { width:44px; height:44px; border-radius:50%; background:var(--yt-surface); }
    .yt-row .yt-ask .yt-icon { width:22px; height:22px; }
    .yt-row .yt-more { width:28px; height:44px; }

    /* ask sheet */
    html.yt-locked, html.yt-locked body { overflow:hidden !important; }
    .yt-sheet-wrap { position:fixed; left:0; right:0; top:0; height:100vh; z-index:99999; display:flex; align-items:flex-end;
      background:#0008; animation:yt-fade .2s ease; }
    .yt-sheet { width:100%; height:88svh; max-height:calc(100% - 12px); background:var(--yt-bg); color:var(--yt-fg);
      border-radius:28px 28px 0 0; display:flex; flex-direction:column; font:15px/1.6 var(--yt-font);
      animation:yt-up .28s cubic-bezier(.2,.8,.2,1); overflow:hidden; }
    @keyframes yt-up { from { transform:translateY(40%); opacity:.4; } }
    @keyframes yt-fade { from { background:#0000; } }
    .yt-handle { width:32px; height:4px; border-radius:2px; background:var(--yt-mute); opacity:.4; margin:10px auto 2px; flex:none; }
    .yt-sheet-head { display:flex; gap:8px; align-items:flex-start; padding:8px 12px 0 20px; flex:none; }
    .yt-sheet-title { flex:1; min-width:0; }
    .yt-overline { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:600; letter-spacing:.01em;
      background:var(--yt-gemini); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .yt-overline .yt-icon { width:16px; height:16px; }
    .yt-sheet-video { font-size:17px; font-weight:500; line-height:1.3; margin-top:6px;
      display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .yt-icon-btn { border:0; background:none; color:var(--yt-mute); width:40px; height:40px; border-radius:50%; display:grid; place-items:center; flex:none; }
    .yt-watch { align-self:flex-start; margin:12px 20px 4px; border:0; border-radius:20px; padding:8px 16px 8px 12px;
      display:flex; align-items:center; gap:6px; background:var(--yt-surface); color:var(--yt-fg); font:500 13.5px var(--yt-font); flex:none; }
    .yt-watch .yt-icon { width:18px; height:18px; }
    .yt-sheet-body { flex:1; overflow-y:auto; padding:4px 20px 20px; overscroll-behavior:contain;
      border-top:1px solid var(--yt-line); margin-top:10px; }
    .yt-user { margin:18px 0 6px auto; width:fit-content; max-width:85%; background:var(--yt-surface);
      padding:10px 16px; border-radius:20px 20px 4px 20px; font-size:14.5px; scroll-margin-top:12px; }
    .yt-bot p { margin:8px 0; }
    .yt-h { font-weight:600; font-size:15.5px; margin:16px 0 4px; }
    .yt-li { padding-left:18px; position:relative; margin:8px 0; }
    .yt-li::before { content:''; position:absolute; left:4px; top:.7em; width:5px; height:5px; border-radius:50%; background:var(--yt-mute); }
    .yt-ts { display:inline-flex; align-items:center; gap:2px; vertical-align:1px; padding:0 8px 0 5px; margin:0 1px;
      border-radius:10px; background:var(--yt-surface); color:var(--yt-accent); font-size:12.5px; font-weight:500;
      line-height:20px; text-decoration:none; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .yt-ts .yt-icon { width:12px; height:12px; }
    .yt-err { color:#d93025; }
    .yt-disclaimer { color:var(--yt-mute); font-size:12px; margin-top:16px; }
    .yt-shimmer { display:grid; gap:10px; margin:18px 0; }
    .yt-shimmer i { height:12px; border-radius:6px; opacity:.35;
      background:linear-gradient(90deg, ${[...GEMINI, GEMINI[0]].map(([, c]) => c)}) 0 0/300% 100%; animation:yt-shim 1.6s linear infinite; }
    @keyframes yt-shim { to { background-position:-300% 0; } }
    .yt-chips { display:flex; gap:8px; overflow-x:auto; padding:10px 16px 2px; flex:none; scrollbar-width:none; }
    .yt-chips:empty { display:none; }
    .yt-chip { flex:none; display:flex; align-items:center; gap:6px; border:1px solid var(--yt-line); background:var(--yt-bg);
      color:var(--yt-fg); border-radius:18px; padding:7px 14px 7px 10px; font:13.5px var(--yt-font); }
    .yt-chip .yt-icon { width:14px; height:14px; }
    .yt-composer { display:flex; align-items:flex-end; gap:4px; margin:10px 12px 12px; padding:4px 4px 4px 18px;
      border-radius:28px; background:var(--yt-surface); flex:none; }
    .yt-composer textarea { flex:1; min-width:0; border:0; outline:0; background:none; color:var(--yt-fg); font:15px/1.4 var(--yt-font);
      padding:10px 0; resize:none; box-sizing:border-box; height:41px; min-height:0 !important; max-height:120px; }
    .yt-send { border:0; width:40px; height:40px; border-radius:50%; background:var(--yt-accent); color:var(--yt-bg); display:grid; place-items:center; }
    .yt-send .yt-icon { width:18px; height:18px; }
  `;
  const style = h('style', { id: 'yourtube-css' }, css);
  document.head.append(style);

  // One shared gradient definition for every spark icon.
  const defs = svg('svg', { style: 'position:absolute;width:0;height:0' },
    svg('linearGradient', { id: 'yt-gemini-grad', x1: 0, y1: 0, x2: 1, y2: 1 },
      ...GEMINI.map(([offset, color]) => svg('stop', { offset, 'stop-color': color }))));
  document.body.append(defs);
  cleanups.push(() => { style.remove(); defs.remove(); });

  // ── Wire-up ─────────────────────────────────────────────────────────────────
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  const scan = () => {
    queued = false;
    let waiting = false;
    for (const el of document.querySelectorAll(CARD_SEL)) el.data ? transform(el) : (waiting = true);
    if (waiting) setTimeout(schedule, 100); // YouTube may attach .data after inserting the node (card stays hidden meanwhile)
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  addEventListener('scroll', schedule, { passive: true }); // catches recycled cards whose .data changed in place
  cleanups.push(() => {
    observer.disconnect();
    removeEventListener('scroll', schedule);
    document.querySelectorAll('.yt-row').forEach(r => r.remove());
    document.querySelectorAll('.yt-x, .yt-native').forEach(e => e.classList.remove('yt-x', 'yt-native'));
  });
  scan();
  installable();

  window.__yourtube = { destroy: () => { ask.close(); cleanups.forEach(f => f()); } };
})();
