// Decision-model adapters: one call shape for every provider.
// decide(provider, state, questions) → { answers: { id: P(yes) }, tokens }
// Questions use our own { ask, yes, no } shape (see classify.mjs) and become noul questions here.

// Each provider names the yes/no descriptions differently: [yes key, no key].
const noul = ([y, n]) => ({ ask, yes, no }) => ({
  type: 'noul', instructions: ask,
  ...(yes && no && { criteria: { [y]: yes, [n]: no } }),
});
const toNoul = (qs, keys) => Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, noul(keys)(q)]));

const post = async (url, headers, body, retries = 6) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      const hinted = +(text.match(/retry in (\d+(?:\.\d+)?)s/i)?.[1] ?? 0); // Gemini says how long to wait
      await new Promise(r => setTimeout(r, Math.max(hinted * 1000 + 500, 2000 * 2 ** attempt)));
      continue;
    }
    throw new Error(`${res.status} ${text.slice(0, 400)}`);
  }
};

export const providers = {
  // Gemini Decisions API (v1beta): up to 1,000 questions per request.
  gemini: ({ key, retries }) => async (state, questions) => {
    const r = await post('https://generativelanguage.googleapis.com/v1beta/decisions', { 'x-goog-api-key': key },
      { model: 'gemini-decision-1', input: state, questions: toNoul(questions, ['true_description', 'false_description']) }, retries);
    return { answers: Object.fromEntries(Object.entries(r.answers).map(([k, a]) => [k, a.noul])), tokens: r.usage?.total_input_tokens ?? r.usage?.input_tokens, raw: r.usage };
  },
  // Cloudflare Workers AI, System One format: up to 64 questions per request.
  clef: ({ account, token, model = 'clef' }) => async (state, questions) => {
    const r = await post(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`,
      { authorization: `Bearer ${token}` }, { model, state, questions: toNoul(questions, ['true', 'false']) });
    const res = r.result ?? r;
    return { answers: Object.fromEntries(Object.entries(res.answers).map(([k, a]) => [k, a.noul])), tokens: res.usage?.input_tokens, raw: res.usage };
  },
};
