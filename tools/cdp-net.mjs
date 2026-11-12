// Evaluate JS in the phone tab while logging youtubei network traffic for N seconds.
// usage: node tools/cdp-net.mjs <seconds> <outfile.json> 'expr'
import { writeFileSync } from 'node:fs';
const PORT = process.env.CDP_PORT ?? 9333;
const [secs, outFile, ...rest] = process.argv.slice(2);
const expr = rest.join(' ');

const targets = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
const t = targets.find(t => t.type === 'page' && t.url.includes('youtube.com'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map(), reqs = new Map();
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
ws.onmessage = async e => {
  const m = JSON.parse(e.data);
  if (m.id) return pending.get(m.id)?.(m);
  if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('/youtubei/')) {
    const { url, method, postData } = m.params.request;
    reqs.set(m.params.requestId, { url, method, postData: postData?.slice(0, 4000) });
  }
  if (m.method === 'Network.loadingFinished' && reqs.has(m.params.requestId)) {
    const body = await send('Network.getResponseBody', { requestId: m.params.requestId });
    reqs.get(m.params.requestId).response = body.result?.body?.slice(0, 20000);
  }
};
await new Promise(r => (ws.onopen = r));
await send('Network.enable', { maxPostDataSize: 65536 });
const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
console.log('eval:', JSON.stringify(res.result?.result?.value ?? res.result?.exceptionDetails));
await new Promise(r => setTimeout(r, secs * 1000));
const all = [...reqs.values()];
writeFileSync(outFile, JSON.stringify(all, null, 2));
console.log(all.map(r => `${r.method} ${r.url.split('?')[0]}  req=${r.postData?.length ?? 0}B resp=${r.response?.length ?? '-'}B`).join('\n'));
ws.close();
