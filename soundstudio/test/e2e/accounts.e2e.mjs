// End-to-end against the real Supabase project (needs internet: E2E_PROXY and
// E2E_ACCOUNTS=1; skipped otherwise). Two players join a jam: each gets an account
// silently, the jam and both players are recorded, they learn each other's account,
// the profile saves, and after leaving the start screen asks "jam again?".
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServers, sleep } from './harness.mjs';

test('accounts: silent sign-up, jam history, profile, jam again', { timeout: 120000, skip: !process.env.E2E_ACCOUNTS }, async () => {
  const h = await startServers({ internet: true });
  try{
    const A = await h.page('Host'), B = await h.page('Guest');
    await h.join(A, h.base, 'Host'); await A.waitForFunction(() => window.getInvite && window.getInvite());
    await h.join(B, await A.evaluate(() => location.href), 'Guest');
    const acc = p => p.evaluate(() => ({ id: window.jamAccount.id(), jam: window.jamAccount.currentJam() }));
    await A.waitForFunction(() => window.jamAccount && window.jamAccount.currentJam(), null, { timeout: 30000 });
    await B.waitForFunction(() => window.jamAccount && window.jamAccount.currentJam(), null, { timeout: 30000 });
    await sleep(1500);   // their rows saved
    const a = await acc(A), b = await acc(B);
    assert.ok(a.id && b.id && a.id !== b.id, 'each has their own account');
    assert.equal(a.jam, b.jam, 'the same jam');
    await A.waitForFunction(() => [...window.jamPeers.values()].some(p => p.uid), null, { timeout: 15000 });
    // B sees both players in the jam (the database rules let you see your own jams' players)
    const rows = await B.evaluate(async jam => (await window.jamAccount.db().from('jam_players').select('user_id, instrument').eq('jam_id', jam)).data, a.jam);
    assert.equal(rows.length, 2, `both players recorded (${JSON.stringify(rows)})`);
    // profile: tap an instrument, it saves
    await A.click('#leaveBtn'); await A.waitForSelector('#joinView:not([hidden])');
    await A.waitForSelector('#rateCard:not([hidden])', { timeout: 20000 });
    assert.match(await A.textContent('#rateList'), /Guest/, 'asks about the guest');
    await A.click('#rateList button:has-text("Yes")');
    await A.click('#pfToggle'); await A.click('#pfGenres button:has-text("Funk")'); await sleep(1500);
    const p = await A.evaluate(() => window.jamAccount.profile());
    assert.ok(p.genres.includes('funk'), 'genre saved'); assert.equal(p.display_name, 'Host');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
