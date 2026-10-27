/**
 * Gain/loss report from the permanent trade journal.
 *   npm run report            (reads dashboard/data/trades.csv)
 *   node dashboard/report.js path/to/trades.csv
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const file = process.argv[2] ?? fileURLToPath(new URL('data/trades.csv', import.meta.url));
const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
const cols = head.split(',');
const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
if (!rows.length) { console.log('Aucun trade enregistré.'); process.exit(0); }

const sum = (a) => a.reduce((x, y) => x + y, 0);
const pnl = rows.map((r) => +r.pnl);
const wins = pnl.filter((x) => x > 0), losses = pnl.filter((x) => x <= 0);
const bySym = {};
for (const r of rows) (bySym[r.symbol] ??= []).push(+r.pnl);

console.log(`Période      : ${rows[0].open_time} → ${rows.at(-1).close_time}`);
console.log(`Trades       : ${rows.length} (${wins.length} gagnants / ${losses.length} perdants, win rate ${(wins.length / rows.length * 100).toFixed(1)} %)`);
console.log(`Gain net     : ${sum(pnl).toFixed(2)} $   (frais inclus : ${sum(rows.map((r) => +r.fees)).toFixed(2)} $)`);
console.log(`Gain moyen   : ${wins.length ? (sum(wins) / wins.length).toFixed(2) : '-'} $   Perte moyenne : ${losses.length ? (sum(losses) / losses.length).toFixed(2) : '-'} $`);
console.log(`Profit factor: ${losses.length && sum(losses) ? (sum(wins) / -sum(losses)).toFixed(2) : '-'}  (> 1 = rentable)`);
for (const [sym, p] of Object.entries(bySym)) console.log(`  ${sym.padEnd(8)} ${String(p.length).padStart(4)} trades  ${sum(p).toFixed(2)} $`);
