// Accounts and jam history (Supabase; tables in supabase/migrations).
// Everyone gets an account silently (anonymous), so joining needs no sign-up and
// nothing here ever holds up a jam: it loads after the page and every call is
// best-effort. Saving an email turns it into a full account (same id, same history).
// Recorded for matchmaking later: who played with whom, as what, how far apart on
// the network, and whether they'd jam again.
const SB_URL = 'https://kjfhwttykgghpbjjovwu.supabase.co';
const KEY = 'sb_publishable_NLZCXqiCj_LMsHzfU1VziA_Y2yh9oh3';   // public by design: the database rules decide what it can do
const LIB = '/vendor/supabase-2.117.2.js';
const JAM = window.__SS_NATIVE ? 'https://air.band/jam/' : location.origin + '/jam/';   // where sign-in links and Google bring you back (the app's own address only works on that computer)

let sb = null, user = null, ready = null, watching = false;
export const hooks = { onChange: () => {} };   // signed in / profile saved

function load(){
  if(window.supabase) return Promise.resolve(window.supabase);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIB; s.onload = () => res(window.supabase); s.onerror = rej; document.head.appendChild(s); });
}
// Start: your account (made silently the first time). Resolves to the user, or null offline.
// A network blip is retried a few times (2, 5, 15 s); after that, the next call tries again.
export function init(name){
  return ready || (ready = (async () => {
    for(const wait of [0, 2000, 5000, 15000]){
      if(wait) await new Promise(r => setTimeout(r, wait));
      const u = await attempt(name); if(u) return u;
    }
    ready = null; return null;
  })());
}
// The connection, without signing anyone in (the landing page uses just this).
async function client(){
  const lib = await load();
  if(!sb) sb = lib.createClient(SB_URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ss.auth' } });
  return sb;
}
async function attempt(name){
  try{
    await client();
    let { data } = await sb.auth.getSession();
    if(!data.session){ const r = await sb.auth.signInAnonymously({ options: { data: { display_name: name || '' } } }); if(r.error) throw r.error; data = r.data; }
    user = data.session.user;
    if(!watching){ watching = true; sb.auth.onAuthStateChange((_e, s) => { if(s && s.user && (!user || s.user.id !== user.id || s.user.email !== user.email)){ user = s.user; hooks.onChange(); } }); }
    return user;
  }catch(e){ console.warn('accounts unavailable', e); return null; }
}
export const id = () => user && user.id;
export const email = () => user && (user.email || user.new_email) || '';
export const saved = () => !!(user && !user.is_anonymous && (user.email || (user.identities || []).length));   // a full account (email or Google)

// ---- profile ----
export async function profile(){
  if(!await init()) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  return data;
}
export async function saveProfile(p){
  if(!await init()) return false;
  const row = {};
  for(const k of ['display_name', 'instruments', 'genres', 'level', 'country', 'bio']) if(p[k] !== undefined) row[k] = p[k];
  const { error } = await sb.from('profiles').update(row).eq('id', user.id);
  if(error) console.warn('profile not saved', error);
  return !error;
}
// Keep this account: an email to confirm (a link). Same account, same history.
export async function addEmail(address){
  if(!await init()) throw new Error('Accounts are offline right now');
  const { error } = await sb.auth.updateUser({ email: address }, { emailRedirectTo: JAM });
  if(error) throw error;
}
// Already have an account (another device): a sign-in link by email.
export async function signIn(address){
  if(!await init()) throw new Error('Accounts are offline right now');
  const { error } = await sb.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false, emailRedirectTo: JAM } });
  if(error) throw error;
}
// Google: offered only once it's switched on in the project (it needs Google's keys).
export async function googleOn(){
  try{ const r = await fetch(SB_URL + '/auth/v1/settings', { headers: { apikey: KEY } }); return !!(await r.json()).external.google; }catch(e){ return false; }
}
// Continue with Google: adds Google to this account (anonymous: keeps its jams); if that
// Google account already has an airband account, signs in to that one instead.
export async function google(){
  if(!await init()) throw new Error('Accounts are offline right now');
  const opts = { provider: 'google', options: { redirectTo: JAM } };
  if(user.is_anonymous){ const { error } = await sb.auth.linkIdentity(opts); if(!error) return; if(!/already|exists|linked/i.test(error.message)) throw error; }
  const { error } = await sb.auth.signInWithOAuth(opts); if(error) throw error;
}
export async function signOut(){ if(!sb) return; await sb.auth.signOut(); user = null; ready = null; localStorage.removeItem('ss.lastJam'); await init(); hooks.onChange(); }
export async function deleteMe(){ if(!await init()) return; await sb.rpc('delete_me'); await signOut(); }

// ---- jams ----
let jam = null, seen = null;
// You're in a room: record the jam (once, whoever gets there first) and you in it.
export async function joined(roomId, { creator, instrument, engine, mode, bars }){
  if(!roomId || !await init()) return;
  jam = roomId;
  const { error } = await sb.rpc('join_jam', { jam: roomId, creator: !!creator, instrument, engine, mode, bars });
  if(error) console.warn('jam not recorded', error);
  clearInterval(seen); seen = setInterval(() => sb.from('jam_players').update({ left_at: new Date().toISOString() }).eq('jam_id', jam).eq('user_id', user.id).then(() => {}), 60000);   // "last seen", in case the tab just closes
}
// The jam's settings, from whoever started it.
export function jamInfo(info){ if(jam && user) sb.from('jams').update(info).eq('id', jam).eq('created_by', user.id).then(() => {}); }
// How far apart you and another player are: one row a minute, from your side.
export function latency(otherId, m){
  if(!jam || !user || !otherId || otherId === user.id) return;
  sb.from('pair_latency').insert({ jam_id: jam, a: user.id, b: otherId, one_way_ms: m.totalMs, network_ms: m.netMs, jitter_ms: m.jitterMs, loss_pct: m.lossPct, route: m.route }).then(() => {});
}
export function left(){ if(jam && user){ clearInterval(seen); sb.from('jam_players').update({ left_at: new Date().toISOString() }).eq('jam_id', jam).eq('user_id', user.id).then(() => {}); } }
// "Would you jam with them again?"
export async function rate(jamId, otherId, again){
  if(!await init()) return false;
  const { error } = await sb.from('ratings').upsert({ jam_id: jamId, rater: user.id, ratee: otherId, again }, { onConflict: 'jam_id,rater,ratee' });
  return !error;
}
export const currentJam = () => jam;
export const db = () => sb;   // tests

// ---- the landing page: sign up / sign in without making an anonymous account first ----
// Whoever is signed in on this device already (a full account), or null.
export async function current(){
  try{ await client(); const { data } = await sb.auth.getSession(); const u = data.session && data.session.user; return u && !u.is_anonymous ? u : null; }catch(e){ return null; }
}
// Continue with email: a link that signs you in (and makes the account if it's new).
export async function emailLink(address){
  await client();
  const { data } = await sb.auth.getSession();
  if(data.session && data.session.user.is_anonymous){ user = data.session.user; return addEmail(address); }   // keep this device's jams
  const { error } = await sb.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true, emailRedirectTo: JAM } });
  if(error) throw error;
}
export async function googleIn(){
  await client();
  const { data } = await sb.auth.getSession();
  if(data.session){ user = data.session.user; return google(); }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: JAM } }); if(error) throw error;
}
export async function signOutHere(){ await client(); await sb.auth.signOut(); user = null; ready = null; }
