// Stickers: the built-in pack (public/stickers) plus stickers Ansa uploads on the admin page.
// Uploaded stickers are saved in Supabase (table from supabase-stickers.sql); without Supabase they stay in memory.
const fs = require('fs');
const path = require('path');
const SB_URL = (() => { const raw = (process.env.SUPABASE_URL || '').trim(); if (!raw) return ''; try { return new URL(raw.includes('://') ? raw : 'https://' + raw).origin; } catch (e) { return raw.replace(/\/+$/, ''); } })();
const SERVICE = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const enabled = !!(SB_URL && SERVICE && (process.env.SUPABASE_ANON_KEY || '').trim());
const MAX_BYTES = 300 * 1024;

async function sb(p, opts = {}) {
  const r = await fetch(SB_URL + p, { ...opts, headers: { apikey: SERVICE, ...(SERVICE.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + SERVICE }), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw new Error('Supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

const builtin = [];
try { for (const pk of JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'stickers', 'stickers.json'), 'utf8')).packs) for (const st of pk.stickers) builtin.push({ id: st.id, line: st.line, src: `/stickers/${st.id}.svg`, builtin: true }); } catch (e) { console.error('stickers', e.message); }

const custom = new Map(); // id -> { id, line, data, v }
let loaded = false;
async function load() {
  if (loaded || !enabled) { loaded = true; return; }
  try { for (const r of await sb('/rest/v1/stickers?select=id,line,data&order=created_at.asc') || []) custom.set(r.id, { ...r, v: ver(r.data) }); loaded = true; }
  catch (e) { console.error('stickers load', e.message); }
}
const ver = s => { let h = 0; for (let i = 0; i < s.length; i += 11) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

function list() {
  return [...builtin, ...[...custom.values()].map(c => ({ id: c.id, line: c.line, src: `/sticker-img/${c.id}?v=${c.v}` }))];
}
const has = id => builtin.some(b => b.id === id) || custom.has(id);
function image(id) {
  const c = custom.get(id); if (!c) return null;
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,(.+)$/.exec(c.data); if (!m) return null;
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}
async function add(line, data) {
  line = String(line || '').replace(/[<>]/g, '').trim().slice(0, 30);
  data = String(data || '');
  if (!line) return { error: 'Type the sticker line' };
  if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(data)) return { error: 'Use a PNG, JPG, WebP or SVG picture' };
  if (data.length * 0.75 > MAX_BYTES) return { error: 'Picture is too big (max 300 KB)' };
  const id = 'c' + Date.now().toString(36);
  if (enabled) await sb('/rest/v1/stickers', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, line, data }) });
  custom.set(id, { id, line, data, v: ver(data) });
  return { id };
}
async function remove(id) {
  if (!custom.has(id)) return { error: 'Built-in stickers cannot be removed here' };
  if (enabled) await sb(`/rest/v1/stickers?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  custom.delete(id); return {};
}

module.exports = { load, list, has, image, add, remove };
