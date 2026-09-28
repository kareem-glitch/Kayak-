// The room's setup drawers (Band, Tone, Audio, Takes, Stats): one open at a
// time beside the stage (a sheet from the bottom on phones). Tapping the open
// tab closes it. On a wide screen the Band drawer starts open.
import { $ } from './util.js';

let open = null;
export const current = () => open;
export function show(name){
  open = name;
  document.querySelectorAll('[data-drawer-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.drawerTab === name)));
  document.querySelectorAll('[data-drawer]').forEach(p => { p.hidden = p.dataset.drawer !== name; });
  $('#drawer').hidden = !name;
  try{ localStorage.setItem('ss.drawer', name || ''); }catch(e){}
}
export const toggle = name => show(open === name ? null : name);

document.querySelectorAll('[data-drawer-tab]').forEach(t => t.onclick = () => toggle(t.dataset.drawerTab));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => show(b.dataset.open)));
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => show(null));

// First view in a room: wide screens open your last drawer (Band the first time); phones start on the stage.
export function start(){
  let last = 'band'; try{ const v = localStorage.getItem('ss.drawer'); if(v !== null) last = v || null; }catch(e){}
  show(matchMedia('(max-width:860px)').matches ? null : last);
}
