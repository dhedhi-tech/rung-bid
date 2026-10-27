// Player reports (Report button on the player card). Saved to Supabase (table from supabase-reports.sql) and listed on the admin page.
// Without Supabase, kept in memory for local testing.
const S = require('./stats');
const mem = [];

async function add(r) {
  if (!S.enabled) { mem.unshift({ ...r, at: new Date().toISOString() }); if (mem.length > 500) mem.pop(); return; }
  await S.sb('/rest/v1/reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(r) });
}
async function list() {
  if (!S.enabled) return mem.slice(0, 100);
  const r = await S.sb('/rest/v1/reports?select=*&order=at.desc&limit=100');
  return r.data || [];
}
module.exports = { add, list, REASONS: ['Bad language', 'Bullying or harassment', 'Cheating', 'Bad name or picture', 'Something else'] };
