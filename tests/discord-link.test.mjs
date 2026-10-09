import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../account/discord/link/index.html', import.meta.url), 'utf8');
const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const settle = () => new Promise(resolve => setImmediate(resolve));

async function page(options = {}) {
  let user = options.user ?? { id: 'account-a', email: 'member@example.test' };
  let authCallback;
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(x => x[1]);
  const els = Object.fromEntries(ids.map(id => [id, {
    hidden: ['signedIn', 'signedOut', 'status', 'error'].includes(id),
    disabled: id === 'redeemButton', textContent: '', value: '',
    addEventListener(type, callback) { this[type] = callback; }
  }]));
  const storage = new Map([['underweb:discord-link-token', 'private-test-link']]);
  const invocations = [];
  const client = {
    auth: {
      getUser: async token => options.getUser ? options.getUser(token) : ({ data: { user }, error: null }),
      getSession: async () => ({ data: { session: user ? { access_token: 'checked-session-token' } : null }, error: null }),
      signInWithOtp: async () => { if (options.otpThrows) throw new Error('offline'); return { error: null }; },
      onAuthStateChange: callback => { authCallback = callback; }
    },
    functions: {
      invoke: async (name, args) => {
        invocations.push({ name, args });
        if (options.invokeThrows) throw new Error('offline');
        return { data: { linked: true }, error: null };
      }
    }
  };
  const context = vm.createContext({
    URL, document: { getElementById: id => els[id], title: 'UnderWeb' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val), removeItem: key => storage.delete(key) },
    window: { location: { href: 'https://www.underweb.cloud/account/discord/link' }, history: { replaceState() {} },
      setTimeout: callback => setTimeout(callback, 0), supabase: { createClient: () => client } }
  });
  vm.runInContext(source, context);
  await settle();
  return { els, storage, invocations, changeUser: value => { user = value; },
    refresh: async () => { authCallback(); await new Promise(r => setTimeout(r, 5)); } };
}

test('confirmation names the verified UnderWeb account without HTML insertion', async () => {
  const p = await page({ user: { id: 'account-a', email: '<member>@example.test' } });
  assert.equal(p.els.accountEmail.textContent, '<member>@example.test');
  assert.equal(p.els.signedIn.hidden, false);
  assert.equal(p.els.redeemButton.disabled, false);
});

test('a switched account requires another explicit confirmation', async () => {
  const p = await page();
  p.changeUser({ id: 'account-b', email: 'new@example.test' });
  await p.els.redeemButton.click();
  assert.equal(p.invocations.length, 0);
  assert.equal(p.els.accountEmail.textContent, 'new@example.test');
  assert.match(p.els.error.textContent, /account changed/);
});

test('redemption uses the checked session and success survives auth refresh', async () => {
  const p = await page();
  await p.els.redeemButton.click();
  assert.equal(p.invocations.length, 1);
  assert.equal(p.invocations[0].args.headers.Authorization, 'Bearer checked-session-token');
  assert.equal(p.storage.has('underweb:discord-link-token'), false);
  await p.refresh();
  assert.equal(p.els.status.hidden, false);
  assert.equal(p.els.error.hidden, true);
  assert.match(p.els.status.textContent, /now linked/);
});

test('redemption interruption leaves confirmation available to retry', async () => {
  const p = await page({ invokeThrows: true });
  await p.els.redeemButton.click();
  assert.equal(p.els.redeemButton.disabled, false);
  assert.equal(p.storage.has('underweb:discord-link-token'), true);
  assert.match(p.els.error.textContent, /interrupted/);
});

test('an expired session cannot redeem a link', async () => {
  const p = await page();
  p.changeUser(null);
  await p.els.redeemButton.click();
  assert.equal(p.invocations.length, 0);
  assert.equal(p.els.signedIn.hidden, true);
  assert.equal(p.els.signedOut.hidden, false);
  assert.equal(p.els.redeemButton.disabled, true);
});

test('email request interruption releases its button', async () => {
  const p = await page({ otpThrows: true });
  p.els.email.value = 'member@example.test';
  await p.els.signInForm.submit({ preventDefault() {} });
  assert.equal(p.els.signInButton.disabled, false);
  assert.match(p.els.error.textContent, /sign-in could not start/);
});
