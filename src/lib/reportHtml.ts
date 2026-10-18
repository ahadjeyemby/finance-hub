import { dayLabel, monthLabel } from '@/core/dates';
import { forecastMonth } from '@/core/forecast';
import { dollars, listTxns, runQuery } from '@/core/queries';
import type { Ctx, QuerySpec } from '@/core/queries';
import { categoryLabel } from '@/core/categories';
import type { ReportSpec } from '@/core/report';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const fmt = (q: QuerySpec, v: number) => (q.metric === 'count' ? String(v) : dollars(v));

/** Plain printable HTML for a report. Charts print as labelled bars with exact figures. */
export function reportToHtml(spec: ReportSpec, ctx: Ctx, dataTo: string): string {
  const parts: string[] = [];
  for (const b of spec.blocks) {
    if (b.type === 'kpis') parts.push(`<div class="kpis">${b.items.map((i) => `<div class="kpi"><small>${esc(i.label)}</small><b>${fmt(i.query, runQuery(i.query, ctx).total)}</b></div>`).join('')}</div>`);
    else if (b.type === 'chart') {
      const r = runQuery(b.query, ctx);
      const max = Math.max(1, ...r.rows.map((x) => Math.abs(x.value)));
      const label = (k: string, l: string) => (b.query.groupBy === 'category' ? categoryLabel(k) : l);
      parts.push(`<h2>${esc(b.title)}</h2>${b.subtitle ? `<p class="s">${esc(b.subtitle)}</p>` : ''}<table>${r.rows.map((x) => `<tr><td>${esc(label(x.key, x.long))}</td><td class="bar"><i style="width:${Math.max(1, (Math.abs(x.value) / max) * 100)}%"></i></td><td class="n">${fmt(b.query, x.value)}</td></tr>`).join('')}</table>`);
    } else if (b.type === 'table') {
      if (b.kind === 'groups' && b.query) parts.push(`<h2>${esc(b.title)}</h2><table>${runQuery(b.query, ctx).rows.map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${fmt(b.query!, x.value)}</td></tr>`).join('')}</table>`);
      else parts.push(`<h2>${esc(b.title)}</h2><table>${listTxns(ctx, b.filter ?? {}, b.limit ?? 25, b.order ?? 'date_desc').map((t) => `<tr><td>${dayLabel(t.date)}</td><td>${esc(t.merchant)}</td><td class="n">${dollars(t.cents, { sign: true })}</td></tr>`).join('')}</table>`);
    } else if (b.type === 'forecast') { const f = forecastMonth(ctx, b.month, dataTo); parts.push(`<h2>Forecast: ${monthLabel(f.month)}</h2><p><b>${dollars(f.total, { decimals: false })}</b> (likely ${dollars(f.low, { decimals: false })} to ${dollars(f.high, { decimals: false })}). ${esc(f.caveat)}</p>`); }
    else parts.push(`${b.title ? `<h2>${esc(b.title)}</h2>` : ''}<p>${esc(b.text)}</p>`);
  }
  const notes = (spec.notes ?? []).map((n) => `<p class="note">${esc(n)}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Helvetica,Arial,sans-serif;color:#1B1A18;padding:28px;max-width:760px;margin:auto}h1{font-size:24px;margin:0}h2{font-size:15px;margin:22px 0 6px}.s,small{color:#5E5C56;font-size:12px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.kpi{border:1px solid #D9D6CF;border-radius:8px;padding:8px 12px;min-width:120px}.kpi b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse;font-size:12px}td{padding:5px 4px;border-bottom:1px solid #E8E6E1}td.n{text-align:right;font-weight:700;white-space:nowrap}td.bar{width:38%}td.bar i{display:block;height:8px;background:#3A3D44;border-radius:0 4px 4px 0}
.note{background:#FFF1CC;color:#5C3F00;padding:8px 10px;border-radius:6px;font-size:12px}</style></head><body><h1>${esc(spec.title)}</h1><p class="s">${esc(spec.period.label)}${spec.subtitle ? ' &middot; ' + esc(spec.subtitle) : ''}</p>${notes}${parts.join('')}<p class="s" style="margin-top:28px">Built from statements through ${dayLabel(dataTo)}.</p></body></html>`;
}
