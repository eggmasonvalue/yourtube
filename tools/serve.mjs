// Serve src/ to the phone over `adb reverse` so Tampermonkey can install/update the userscript.
// usage: node tools/serve.mjs   → phone opens http://localhost:8787/yourtube.user.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const PORT = 8787;
execFileSync('adb', ['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
createServer(async (req, res) => {
  try {
    const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'yourtube.user.js';
    if (name.includes('..')) throw new Error('bad path');
    const body = await readFile(new URL(`../src/${name}`, import.meta.url));
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(body);
    console.log(new Date().toISOString(), 'served', name);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`serving src/ on :${PORT} (adb reverse active)`));
