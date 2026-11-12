// Tiny CDP client: evaluate JS in the phone's Vivaldi tab.
// usage: node tools/cdp.mjs [--url-match m.youtube.com] [--file x.js | 'expr']
const PORT = process.env.CDP_PORT ?? 9333;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const match = opt('--url-match', 'youtube.com');
const file = opt('--file');
const method = opt('--method'); // raw CDP call, e.g. --method Page.getInstallabilityErrors '{}'
const expr = file ? (await import('node:fs')).readFileSync(file, 'utf8') : args.join(' ');

const targets = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const t = targets.find(t => t.type === 'page' && t.url.includes(match));
if (!t) throw new Error(`no tab matching ${match}: ${targets.map(t => t.url)}`);

const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await new Promise(r => (ws.onopen = r));

const res = method
  ? await send(method, JSON.parse(expr || '{}'))
  : await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
const out = res.result?.exceptionDetails ?? res.result?.result?.value ?? res;
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
ws.close();
