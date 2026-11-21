// Generates a printable one-line + device schedule of the Sparks system for instructor markup.
// Usage: npx tsx scripts/oneline.ts > sparks-oneline.html

import { TOPO as T, SUB_SPECS } from '../src/sim/topology';
import type { DevEl } from '../src/sim/types';
const mi = (m: number) => (m / 1609.34).toFixed(2);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const devMile: Record<string, number> = {};
let pages = '';
for (const fid of T.feederIds) {
  const F = T.feeders[fid];
  const W = 1500, X0 = 70, X1 = W - 90, Y = 150;
  const x = (f: number) => X0 + f * (X1 - X0);
  let svg = `<line x1="${X0}" y1="${Y}" x2="${X1}" y2="${Y}" stroke="#111" stroke-width="3"/>`;
  svg += `<text x="${X0 - 55}" y="${Y + 34}" font-size="11" font-weight="700">${esc(SUB_SPECS.find(s => s.id === F.sub)!.name)} SUB</text>`;
  let latRow = 0;
  for (const it of F.sch) {
    const X = x(it.f); devMile[it.id] = it.f * F.length;
    if (it.kind === 'lat') {
      const lat = T.laterals[it.id]; const cust = lat.loads.reduce((a, l) => a + T.loads[l].customers, 0);
      const up = latRow++ % 2 === 0, y2 = up ? Y - 62 : Y + 62;
      svg += `<line x1="${X}" y1="${Y}" x2="${X}" y2="${y2}" stroke="#555" stroke-width="1.5"/><rect x="${X - 4}" y="${(Y + y2) / 2 - 7}" width="8" height="14" fill="#fff" stroke="#111"/>`;
      svg += `<text x="${X}" y="${up ? y2 - 16 : y2 + 12}" font-size="9.5" text-anchor="middle">${it.id}</text><text x="${X}" y="${up ? y2 - 5 : y2 + 23}" font-size="8.5" text-anchor="middle" fill="#555">${lat.loads.length}tx/${cust}c</text>`;
    } else if (it.kind === 'load') {
      const L = T.loads[it.id];
      svg += `<line x1="${X}" y1="${Y}" x2="${X}" y2="${Y + 95}" stroke="#a00" stroke-width="1.5"/><text x="${X}" y="${Y + 108}" font-size="9.5" text-anchor="middle" fill="#a00" font-weight="700">★ ${esc(L.name ?? '')}</text>`;
    } else {
      const d = T.els[it.id] as DevEl;
      const lbl = (t: string, dy = -14) => `<text x="${X}" y="${Y + dy}" font-size="10.5" text-anchor="middle" font-weight="700">${t}</text>`;
      if (d.type === 'breaker') svg += `<rect x="${X - 10}" y="${Y - 10}" width="20" height="20" fill="#c00"/><text x="${X}" y="${Y + 4}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">CB</text>${lbl(d.id, -16)}<rect x="${X + 14}" y="${Y - 5}" width="10" height="10" fill="#fff" stroke="#c00"/><text x="${X + 19}" y="${Y + 20}" font-size="8.5" text-anchor="middle" fill="#555">D-${d.id.slice(3)}L</text>`;
      else if (d.type === 'recloser') {
        const n = d.id.slice(2);
        svg += `<path d="M${X - 34} ${Y} v-30 h68 v30" fill="none" stroke="#06c" stroke-width="1.5" stroke-dasharray="5 3"/><text x="${X}" y="${Y - 34}" font-size="9" text-anchor="middle" fill="#06c">BP-${n} (N.O.)</text>`;
        svg += `<rect x="${X - 31}" y="${Y - 5}" width="10" height="10" fill="#fff" stroke="#06c"/><rect x="${X + 21}" y="${Y - 5}" width="10" height="10" fill="#fff" stroke="#06c"/>`;
        svg += `<rect x="${X - 10}" y="${Y - 10}" width="20" height="20" fill="#06c"/><text x="${X}" y="${Y + 4}" font-size="9" fill="#fff" text-anchor="middle" font-weight="700">R</text>`;
        svg += `<text x="${X}" y="${Y + 26}" font-size="10.5" text-anchor="middle" font-weight="700">${d.id}</text><text x="${X}" y="${Y + 38}" font-size="8.5" text-anchor="middle" fill="#555">D-${n}A · D-${n}B</text>`;
      } else if (d.type === 'tie') {
        const other = T.feederIds.find(o => o !== fid && T.feeders[o].ties.includes(d.id));
        svg += `<line x1="${X}" y1="${Y}" x2="${X}" y2="${Y + 118}" stroke="#111" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${X}" cy="${Y + 125}" r="7" fill="#fff" stroke="#0a0" stroke-width="2.5"/>`;
        svg += `<text x="${X}" y="${Y + 146}" font-size="10.5" text-anchor="middle" font-weight="700" fill="#070">${d.id} N.O.</text><text x="${X}" y="${Y + 158}" font-size="9" text-anchor="middle" fill="#070">to ${other}</text>`;
      } else {
        svg += `<circle cx="${X}" cy="${Y}" r="7" fill="#111"/>${lbl(d.id)}`;
      }
    }
  }
  for (const v of [0, 0.25, 0.5, 0.75, 1]) svg += `<text x="${x(v)}" y="${Y + 182}" font-size="9" text-anchor="middle" fill="#777">${mi(v * F.length)} mi</text>`;
  const cust = T.loadIds.filter(l => T.loads[l].feeder === fid).reduce((a, l) => a + T.loads[l].customers, 0);
  pages += `<section><h2>${fid} <span>${mi(F.length)} mi · ${cust} customers · ${F.ratingA} A planning limit · 12.47 kV</span></h2><svg viewBox="0 0 ${W} 345" width="100%">${svg}</svg><div class="notes">Markup notes:</div></section>`;
}
// Device schedule
const rows = T.devIds.filter(id => !['xfmr', 'fuse'].includes((T.els[id] as DevEl).type)).map(id => {
  const d = T.els[id] as DevEl;
  const f = T.feeders[d.feeder];
  const m = devMile[id] ?? devMile[d.grp ?? ''] ?? (f.sch.find(s => s.id === id)?.f ?? 0) * f.length;
  return { d, m };
}).sort((a, b) => a.d.feeder.localeCompare(b.d.feeder) || a.m - b.m || a.d.id.localeCompare(b.d.id));
let tbl = rows.map(({ d, m }) => `<tr><td><b>${d.id}</b></td><td>${d.feeder}</td><td>${mi(m)}</td><td>${esc(d.equip ?? d.type)}</td><td>${d.normalOpen ? 'OPEN' : 'Closed'}</td><td>${d.lb === false ? '<b>NO</b>' : 'Yes'}</td><td>${d.scada ? 'Yes' : '—'}</td><td>${T.devCust[d.id] ?? ''}</td><td>${esc(d.loc)}</td><td class="mk"></td></tr>`).join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Sparks Municipal Electric — One-line for review</title><style>
@page { size: 17in 11in; margin: 0.4in; } body { font-family: Arial, sans-serif; color: #111; }
h1 { font-size: 20px; margin: 0 0 2px; } .sub { color: #555; font-size: 12px; margin-bottom: 10px; }
section { page-break-inside: avoid; border: 1px solid #bbb; padding: 6px 10px; margin-bottom: 10px; }
h2 { font-size: 15px; margin: 2px 0; } h2 span { font-weight: 400; color: #555; font-size: 12px; }
.notes { border-top: 1px dashed #aaa; height: 40px; font-size: 10px; color: #888; padding-top: 2px; }
table { border-collapse: collapse; width: 100%; font-size: 10.5px; page-break-before: always; } th, td { border: 1px solid #999; padding: 3px 5px; text-align: left; } th { background: #eee; } td.mk { width: 22%; }
.legend { font-size: 11px; margin: 6px 0 12px; } .legend b { margin-right: 14px; }
</style></head><body>
<h1>Sparks Municipal Electric — Distribution One-Line (DRAFT for instructor review)</h1>
<div class="sub">GRID OPS training system · fictional system · 3 substations, 6 feeders, 12.47 kV · Generated ${new Date().toISOString().slice(0, 10)} · Mark up anything that isn't standard practice.</div>
<div class="legend"><b>■ CB</b> feeder breaker + getaway disconnect D-xxxxL <b style="color:#06c">■ R</b> recloser with 3-switch bypass (D-A source disc, D-B load disc, BP bypass N.O.) <b>●</b> GOAB sectionalizing switch (load-break) <b style="color:#070">○</b> N.O. tie switch (load-break) <b>▯</b> lateral tap fuse (tx/customers) <b style="color:#a00">★</b> critical customer</div>
${pages}
<table><thead><tr><th>Device</th><th>Feeder</th><th>Mile</th><th>Equipment</th><th>Normal</th><th>Load-break</th><th>SCADA</th><th>Cust. downstream</th><th>Location</th><th>Markup</th></tr></thead><tbody>${tbl}</tbody></table>
<p style="font-size:11px;color:#555">Not shown individually: ${Object.keys(T.laterals).length} lateral tap fuses and ${T.loadIds.length} transformers. Fuses are not used in switching orders; crews refuse them directly.</p>
</body></html>`;
console.log(html);

