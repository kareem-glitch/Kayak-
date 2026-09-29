// The room's setup drawers (Band, Tone, Audio, Takes, and Connection from the
// light in the top bar): one open at a time beside the stage (a sheet from the
// bottom on phones, opened with the settings button). Tapping the open tab
// closes it. The room starts with them all closed: just the stage.
import { $ } from './util.js';

let open = null, lastOpen = null;
export const current = () => open;
export const last = () => lastOpen;
export function show(name){
  open = name; if(name) lastOpen = name;
  document.querySelector('.side').classList.toggle('open', !!name);
  document.querySelectorAll('[data-drawer-tab]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.drawerTab === name)));
  document.querySelectorAll('[data-drawer]').forEach(p => { p.hidden = p.dataset.drawer !== name; });
  $('#drawer').hidden = !name;
}
export const toggle = name => show(open === name ? null : name);

document.querySelectorAll('[data-drawer-tab]').forEach(t => t.onclick = () => toggle(t.dataset.drawerTab));
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => show(b.dataset.open)));
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => show(null));

// First view in a room: just the stage.
export function start(){ show(null); }
