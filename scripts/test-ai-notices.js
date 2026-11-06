const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected import ${name}`);
  }, Map, Set, Math, Number, String, Object, Array, Date, Error });
  return module.exports;
}

class FunctionsHttpError extends Error {
  constructor(status, payload, malformed = false) {
    super('Vendor details must not be shown to users');
    this.context = { status, headers: { get: () => '90' }, json: async () => {
      if (malformed) throw new Error('not JSON');
      return payload;
    } };
  }
}

function assistant(result) {
  return load('src/lib/gemini-assistant.ts', {
    '@supabase/supabase-js': { FunctionsHttpError },
    '@/lib/supabase': { supabase: { functions: { invoke: async () => result } } },
  });
}

test('structured project limits become SNAP quota warnings with retry metadata', async () => {
  const api = assistant({ error: new FunctionsHttpError(429, { code: 'rate_limited', retryAfterSeconds: 120 }) });
  await assert.rejects(api.askGeminiAssistant({ action: 'chat', message: 'hello' }), (error) => {
    assert.ok(error instanceof api.AssistantRateLimitError);
    assert.equal(error.retryAfterSeconds, 120);
    const warning = api.getAssistantQuotaWarning(error);
    assert.match(warning, /SNAP.*quota or request limit has been reached/);
    assert.doesNotMatch(warning, /almost|percent|Gemini/i);
    return true;
  });
});

test('upstream HTTP429 is a quota warning even without valid JSON', async () => {
  const api = assistant({ error: new FunctionsHttpError(429, null, true) });
  await assert.rejects(api.askGeminiAssistant({ action: 'compare', dormIds: ['one', 'two'] }), (error) => {
    assert.ok(error instanceof api.AssistantRateLimitError);
    assert.equal(error.retryAfterSeconds, 90);
    assert.ok(api.getAssistantQuotaWarning(error));
    return true;
  });
});

test('network and HTTP service failures do not pretend that quota has been exhausted', async () => {
  for (const error of [new Error('Network unavailable'), new FunctionsHttpError(503, { error: 'Gemini failed' })]) {
    const api = assistant({ error });
    await assert.rejects(api.askGeminiAssistant({ action: 'chat', message: 'hello' }), (caught) => {
      assert.equal(api.getAssistantQuotaWarning(caught), null);
      assert.doesNotMatch(caught.message, /Gemini|Vendor details/);
      return true;
    });
  }
});

test('assistant answers and prediction reasons always use SNAP display branding', async () => {
  const chat = assistant({ data: { text: 'Gemini recommends this listing.', dormIds: ['one'] } });
  assert.equal((await chat.askGeminiAssistant({ action: 'chat' })).text, 'SNAP recommends this listing.');
  const demand = assistant({ data: { predictions: [{ dormId: 'one', level: 'high', reason: 'GEMINI estimate from history' }] } });
  assert.equal((await demand.predictDormDemand(['one']))[0].reason, 'SNAP estimate from history');
});

test('warning notices reuse the top safe-area surface and expire after three seconds', () => {
  let notice = null;
  let timerMs = null;
  let timerCallback;
  const react = {
    createRef: () => ({ current: null }), createContext: () => ({ Provider: 'provider' }), use: () => notice,
    useState: () => [notice, (next) => { notice = typeof next === 'function' ? next(notice) : next; }],
    useEffect: (effect) => effect(),
    useImperativeHandle: (ref, create) => { ref.current = create(); },
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/components/error-toast.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => ({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: (value) => value }, View: 'View' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 28 }) },
    '@/components/error-notice': { ErrorNotice: 'ErrorNotice' },
  })[name], setTimeout: (callback, ms) => { timerCallback = callback; timerMs = ms; return 1; }, clearTimeout: () => {} });
  const api = module.exports;
  api.ErrorToastProvider({ children: null });
  api.showWarning('SNAP limit reached', 'Local results remain available.');
  assert.equal(notice.tone, 'warning');
  assert.match(notice.message, /^SNAP limit reached:/);
  api.ErrorToastProvider({ children: null });
  assert.equal(timerMs, 3250);
  const tree = api.ErrorToast();
  assert.equal(tree.props.style[1].top, 36);
  assert.equal(tree.props.children.props.tone, 'warning');
  timerCallback();
  assert.equal(notice, null);
  const inline = readFileSync('src/components/error-notice.tsx', 'utf8');
  assert.match(inline, /, 3000\)/);
  assert.match(inline, /tone === 'warning' && styles.warning/);
});

test('chat and comparison surface quota warnings while retaining useful local fallback', () => {
  for (const file of ['app/chat.tsx', 'app/(tabs)/compare.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /getAssistantQuotaWarning\(/);
    assert.match(source, /showWarning\('SNAP limit reached'/);
    assert.doesNotMatch(source, /Gemini is unavailable/);
  }
});
