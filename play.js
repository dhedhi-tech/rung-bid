// Google Play numbers for the admin page: installs, uninstalls, store listing visitors, ratings.
// Google drops these as monthly CSV files (UTF-16) into a private Cloud Storage bucket, a few days late.
// We read them with a read-only service account: env PLAY_SA_KEY = the JSON key file, optional PLAY_BUCKET.
// Kept in memory only (re-read every 6 hours); nothing is stored.
const crypto = require('crypto');

const PKG = 'com.dhedhitech.pattaparty';
const DEV_ID = '9203260132950641138'; // Play Console account id; the bucket is usually named after it
let cache = { at: 0, data: null }, busy = null;

function key() {
  try { const k = JSON.parse(process.env.PLAY_SA_KEY || ''); return k.client_email && k.private_key ? k : null; } catch (e) { return null; }
}
const b64 = x => Buffer.from(x).toString('base64url');
async function token(k) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/devstorage.read_only', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(k.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google sign-in for the key failed: ' + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function gcs(tok, path) {
  const r = await fetch('https://storage.googleapis.com/storage/v1/' + path, { headers: { Authorization: 'Bearer ' + tok } });
  return r;
}
// CSV files are UTF-16 with a BOM; fall back to UTF-8
function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.slice(2)); b.swap16(); return b.toString('utf16le'); }
  return buf.toString('utf8').replace(/^﻿/, '');
}
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); rows.push(out);
  }
  if (!rows.length) return [];
  const h = rows[0].map(x => x.trim().toLowerCase());
  return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] || '').trim()])));
}
// pick a column by words in its name (Google renames columns now and then)
const col = (row, ...words) => { for (const k of Object.keys(row)) if (words.every(w => k.includes(w))) return row[k]; return undefined; };
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/[,%]/g, '')); return isFinite(n) ? n : null; };

async function findBucket(tok) {
  const names = [process.env.PLAY_BUCKET, 'pubsite_prod_rev_' + DEV_ID, 'pubsite_prod_' + DEV_ID].filter(Boolean).map(b => b.replace(/^gs:\/\//, '').replace(/\/.*$/, ''));
  const tried = [];
  for (const b of names) {
    const r = await gcs(tok, `b/${b}/o?prefix=stats/&maxResults=1`);
    if (r.ok) return b;
    tried.push(b + ' (' + r.status + ')');
  }
  throw new Error('Could not open the reports folder. Tried: ' + tried.join(', ') + '. 403 = access not active yet (can take up to a day after the invite).');
}
async function listFiles(tok, bucket) {
  const files = []; let page = '';
  for (let i = 0; i < 10; i++) {
    const r = await gcs(tok, `b/${bucket}/o?prefix=stats/&fields=items(name,updated),nextPageToken&maxResults=1000${page ? '&pageToken=' + page : ''}`);
    if (!r.ok) throw new Error('List failed ' + r.status);
    const j = await r.json(); files.push(...(j.items || []));
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return files.filter(f => f.name.includes(PKG));
}
async function readCSV(tok, bucket, name) {
  const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(name)}?alt=media`, { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) return [];
  return parseCSV(decode(Buffer.from(await r.arrayBuffer())));
}
const months = n => { const out = [], d = new Date(); for (let i = 0; i < n; i++) { out.push(d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0')); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); } return out; };

// Builds { days: [{day, installs, uninstalls, active, visitors, acquisitions, rating}], countries: [...], total, rating, lastDay }
function build(files) {
  const days = {}, D = d => (days[d] = days[d] || { day: d });
  for (const r of files.installs) {
    const d = col(r, 'date'); if (!d) continue; const x = D(d);
    x.installs = num(col(r, 'daily user installs')) ?? num(col(r, 'install events'));
    x.uninstalls = num(col(r, 'daily user uninstalls')) ?? num(col(r, 'uninstall events'));
    x.active = num(col(r, 'active device installs'));
    x.total = num(col(r, 'total user installs'));
  }
  for (const r of files.store) {
    const d = col(r, 'date'); if (!d) continue; const x = D(d);
    x.visitors = (x.visitors || 0) + (num(col(r, 'visitors')) || 0);
    x.acquisitions = (x.acquisitions || 0) + (num(col(r, 'acquisitions')) || 0);
  }
  for (const r of files.ratings) {
    const d = col(r, 'date'); if (!d) continue;
    D(d).rating = num(col(r, 'total average rating'));
  }
  const list = Object.values(days).sort((a, b) => (a.day < b.day ? 1 : -1));
  const lastDay = list.length ? list[0].day : null;
  // countries: installs this month (latest file)
  const cc = {};
  for (const r of files.country) { const c = col(r, 'country'); if (!c) continue; cc[c] = (cc[c] || 0) + (num(col(r, 'daily user installs')) ?? num(col(r, 'install events')) ?? 0); }
  const countries = Object.entries(cc).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => ({ c, n }));
  const withTotal = list.find(x => x.total != null), withRating = list.find(x => x.rating != null), withActive = list.find(x => x.active != null);
  return { days: list.slice(0, 30), countries, total: withTotal ? withTotal.total : null, active: withActive ? withActive.active : null, rating: withRating ? withRating.rating : null, lastDay };
}

async function load() {
  const k = key();
  if (!k) return { off: true };
  const tok = await token(k);
  const bucket = await findBucket(tok);
  const all = await listFiles(tok, bucket);
  const want = months(2), pick = (dir, end) => all.filter(f => f.name.startsWith('stats/' + dir + '/') && f.name.endsWith(end) && want.some(m => f.name.includes('_' + m)));
  const read = async fs => (await Promise.all(fs.map(f => readCSV(tok, bucket, f.name)))).flat();
  const latest = fs => fs.sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, 1);
  const files = {
    installs: await read(pick('installs', '_overview.csv')),
    country: await read(latest(pick('installs', '_country.csv'))),
    ratings: await read(pick('ratings', '_overview.csv')),
    // store listing visitors / acquisitions: one file split by country; sum per day
    store: await read(pick('store_performance', '_country.csv')),
  };
  return { ...build(files), bucket, files: all.length };
}

// Admin page asks; refreshed at most every 6 hours (Google updates once a day)
async function report() {
  if (cache.data && Date.now() - cache.at < 6 * 3600e3) return cache.data;
  if (!busy) busy = load().then(d => { cache = { at: Date.now(), data: d }; return d; })
    .catch(e => { const d = { error: e.message }; cache = { at: Date.now() - 5.5 * 3600e3, data: d }; return d; }) // retry errors after 30 min
    .finally(() => { busy = null; });
  return busy;
}

module.exports = { report, _test: { parseCSV, decode, build } };
