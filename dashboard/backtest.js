/**
 * Replay historical 1m candles through the same engine used live.
 *   node dashboard/backtest.js candles.json [SYMBOL]
 * Accepts Bitget-style arrays or MT5 objects ({time,open,high,low,close,tickVolume,spread}).
 * Spread, when present, is applied around the close; fees and slippage come from engine.js.
 */
import { readFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createEngine } from './engine.js';

const [file, symbol = 'SIM'] = process.argv.slice(2);
const bars = JSON.parse(readFileSync(file, 'utf8')).map((r) => ({
  t: Date.parse(r.time), o: r.open, h: r.high, l: r.low, c: r.close, v: r.tickVolume ?? r.volume,
  half: (r.spread ?? 0) / 100 / 2, // MT5 spread in points, 2 digits
}));

let i = 100;
const feed = {
  candles: async () => bars.slice(i - 99, i + 2), // last bar is "in progress" and dropped by the engine
  ticker: async () => {
    const b = bars[i];
    return { last: b.c, bid: b.c - b.half, ask: b.c + b.half };
  },
};
const engine = createEngine({ feed, symbols: [symbol], statePath: join(mkdtempSync(join(tmpdir(), 'bt-')), 's.json') });
for (; i < bars.length - 1; i++) await engine.cycle();

const s = engine.snapshot();
const hold = (bars[bars.length - 2].c / bars[100].c - 1) * 100;
const eq = s.equity.map((e) => e[1]);
let peak = eq[0], dd = 0;
for (const v of eq) { peak = Math.max(peak, v); dd = Math.min(dd, (v / peak - 1) * 100); }
console.log(JSON.stringify({
  bars: bars.length - 101, from: new Date(bars[100].t).toISOString(), to: new Date(bars[bars.length - 2].t).toISOString(),
  trades: s.trades, wins: s.wins, losses: s.losses, winRatePct: s.winRate && +s.winRate.toFixed(1),
  start: s.initial, end: +s.balance.toFixed(2), pnlPct: +s.pnlPct.toFixed(2), feesPaid: +s.feesPaid.toFixed(2),
  maxDrawdownPct: +dd.toFixed(2), buyAndHoldPct: +hold.toFixed(2),
}, null, 1));
