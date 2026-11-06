const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const dormId = '22222222-2222-4222-8222-222222222222';
function gateway(options = {}) {
  let handler;
  const sent = [];
  const quotaCalls = [];
  const query = (table) => {
    const data = table === 'account_access' ? options.suspended ? { status: 'suspended' } : null
      : table === 'renters' ? { behavior_preferences: { budget_max: 4000, preferred_location: 'Opao', email: 'private@example.invalid', payment_details: 'NEVER_SEND_THIS' } }
        : [{ dorm_id: dormId, name: 'Sample dorm', address: 'Opao', price: 3500, dorm_reviews: [{ rating: 5 }], secret_document: 'NEVER_SEND_THIS' }];
    const value = { data, error: null };
    const chain = { then: (resolve) => Promise.resolve(value).then(resolve), maybeSingle: async () => value };
    for (const name of ['select','eq','in','limit']) chain[name] = () => chain;
    return chain;
  };
  const client = { from: query, auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } }, error: null }) }, rpc: async (name) => {
    quotaCalls.push(name);
    return { data: name === 'consume_ai_request_quota' ? { allowed: options.userQuota !== false } : name === 'consume_ai_project_quota' ? options.projectQuota !== false : name === 'get_public_demand_context' ? { horizon_days:30,listings:[],portfolio:{listing_count:12,inquiries_all_time:240,bookings_all_time:65,monthly_history:[{month:'2026-10',inquiries:20,bookings:4}]} } : [], error: null };
  } };
  const source = readFileSync('supabase/functions/dorm-assistant/index.ts','utf8').replace(/^import .*\r?\n/,'');
  vm.runInNewContext(ts.transpileModule(source,{ compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    createClient: () => client, Request, Response, AbortSignal, URL, Set,
    Deno: { env: { get: (name) => ({ SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'fixture-public', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server', GEMINI_API_KEY: 'fixture-model' })[name] }, serve: (fn) => { handler=fn; } },
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      if (options.timeout) throw new Error('Simulated timeout');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'A useful alternative.', dorm_ids: [dormId,'not-an-allowed-listing'],predictions:[{dorm_id:dormId,level:'moderate',reason:'Pooled inquiry history suggests moderate interest; estimate only.'},{dorm_id:'not-allowed',level:'high',reason:'Bad output'}] }) }] } }] }));
    },
  });
  return { sent, quotaCalls, call: (body, authenticated = true) => handler(new Request('https://fixture.invalid', { method: 'POST', headers: authenticated ? { Authorization: 'Bearer fixture-user' } : {}, body: JSON.stringify(body) })) };
}
test('assistant requires sign-in and blocks suspended accounts before model calls', async () => {
  const anon = gateway(); assert.equal((await anon.call({},false)).status,401); assert.equal(anon.sent.length,0);
  const suspended = gateway({ suspended: true }); assert.equal((await suspended.call({ action:'recommend',dormIds:[dormId] })).status,403); assert.equal(suspended.sent.length,0);
});
test('per-user and project quota limits stop the upstream model request', async () => {
  for (const options of [{ userQuota:false },{ projectQuota:false }]) {
    const api = gateway(options);
    const response=await api.call({ action:'recommend',dormIds:[dormId] });
    assert.equal(response.status,429); assert.equal(api.sent.length,0);
  }
});
test('AI alternatives receive allowlisted public facts and own preferences, not profiles/documents', async () => {
  const api=gateway();
  const response=await api.call({ action:'recommend',dormIds:[dormId],filters:{maxPrice:4000,query:'Opao',private_input:'NEVER_SEND_THIS'} });
  assert.equal(response.status,200);
  const result=await response.json(); assert.deepEqual(result.dormIds,[dormId]);
  const payload=JSON.stringify(api.sent[0]);
  assert.doesNotMatch(payload,/NEVER_SEND_THIS|private@example|fixture-user/);
  assert.match(payload,/budget_max|rating_count|Current filters/);
  assert.deepEqual(api.quotaCalls,['consume_ai_request_quota','consume_ai_project_quota']);
});
test('model network failure returns a recoverable response', async () => {
  const api=gateway({timeout:true});assert.equal((await api.call({action:'recommend',dormIds:[dormId]})).status,504);
});
test('demand combines all-listing history and sourced Philippine context without private identities',async()=>{
  const api=gateway();
  const response=await api.call({action:'predict',dormIds:[dormId]});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.predictions.length,1); assert.equal(result.predictions[0].dormId,dormId);
  assert.equal(result.horizonDays,30);
  const payload=JSON.stringify(api.sent[0]);
  assert.match(payload,/inquiries_all_time|monthly_history/);
  assert.match(payload,/legacy.ched.gov.ph|enrollment.uc.edu.ph/);
  assert.doesNotMatch(payload,/private@example|NEVER_SEND_THIS|fixture-user/);
  assert.ok(api.quotaCalls.includes('get_public_demand_context'));
});
test('notifications route to the actual actor and the correct admin queue', () => {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/notification-routing.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports});
  const route=module.exports.notificationDestination;
  assert.equal(route({type:'admin_owner_verification',related_verification_id:'id'},true).params.tab,'verifications');
  assert.equal(route({type:'lgu_certification',related_dorm_id:'dorm'},true).params.tab,'dorms');
  assert.equal(route({type:'refund_requested',related_request_id:'request'},false,true).pathname,'/owner-panel');
  assert.equal(route({type:'refund_sent',related_request_id:'request'},false,false).pathname,'/booking-history');
  assert.equal(route({type:'support_reply',related_ticket_id:'ticket'}).pathname,'/support-ticket');
});
