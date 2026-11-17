// Alma con OpenAI: traduzione dei messaggi a blocchi nelle Chat Completions e lettura della risposta in diretta (SSE).
const test = require('node:test');
const assert = require('node:assert/strict');
const AI = require('../lib/assistente-openai');

test('i messaggi a blocchi diventano messaggi OpenAI (system, tool_calls, tool, testo)', () => {
  const out = AI.toOpenAI([{ type: 'text', text: 'Sei Alma.' }, { type: 'text', text: 'Oggi è martedì.' }], [
    { role: 'user', content: [{ type: 'text', text: 'Quanti ticket ho?' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Guardo.' }, { type: 'tool_use', id: 'call_1', name: 'ticket_elenco', input: { persona: 'io' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"aperti":3}' }] },
  ]);
  assert.deepEqual(out[0], { role: 'system', content: 'Sei Alma.\n\nOggi è martedì.' });
  assert.deepEqual(out[1], { role: 'user', content: 'Quanti ticket ho?' });
  assert.deepEqual(out[2].tool_calls, [{ id: 'call_1', type: 'function', function: { name: 'ticket_elenco', arguments: '{"persona":"io"}' } }]);
  assert.deepEqual(out[3], { role: 'tool', tool_call_id: 'call_1', content: '{"aperti":3}' });
});

test('conversazione lunga: restano solo gli ultimi 6 risultati delle ricerche', () => {
  const msgs = [];
  for (let i = 0; i < 10; i++) {
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `c${i}`, name: 'cerca', input: {} }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `c${i}`, content: 'x'.repeat(10000) }] });
  }
  const tools = AI.toOpenAI('s', msgs).filter(m => m.role === 'tool');
  assert.equal(tools.filter(m => m.content.length === 10000).length, 6);
  assert.match(tools[0].content, /tolto per spazio/);
});

function sse(events) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = Buffer.from(text);
  return { body: (async function* () { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7); })() };
}

test('risposta in diretta: testo a pezzi, ricerche chieste e uso dei token', async () => {
  const pieces = [], tools = [];
  const r = await AI.readStream(sse([
    { choices: [{ delta: { content: 'Ciao ' } }] },
    { choices: [{ delta: { content: 'Dante' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'crm_cerca', arguments: '{"tes' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'to":"Rossi"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 600 } } },
  ]), { onText: t => pieces.push(t), onTool: n => tools.push(n) });
  assert.deepEqual(pieces, ['Ciao ', 'Dante']);
  assert.deepEqual(tools, ['crm_cerca']);
  const resp = AI.toResponse(r);
  assert.equal(resp.stop_reason, 'tool_use');
  assert.deepEqual(resp.content, [{ type: 'text', text: 'Ciao Dante' }, { type: 'tool_use', id: 'call_9', name: 'crm_cerca', input: { testo: 'Rossi' } }]);
  assert.deepEqual(resp.usage, { input_tokens: 400, output_tokens: 20, cache_read_input_tokens: 600, cache_creation_input_tokens: 0 });
  assert.ok(AI.costOf(resp.usage, AI.MODELS.haiku) > 0);
});

test('fine normale e risposta troncata', async () => {
  assert.equal(AI.toResponse(await AI.readStream(sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]), {})).stop_reason, 'end_turn');
  assert.equal(AI.toResponse(await AI.readStream(sse([{ choices: [{ delta: { content: 'o' }, finish_reason: 'length' }] }]), {})).stop_reason, 'max_tokens');
});
