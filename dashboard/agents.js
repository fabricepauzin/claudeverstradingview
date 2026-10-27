/**
 * Six independent signal agents. Each returns { vote: 1 | 0 | -1, veto?: true, note }.
 * Inputs are closed 1m candles (oldest first). Thresholds follow rules.json.
 */
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function ema(values, period) {
  const k = 2 / (period + 1);
  return values.reduce((prev, x, i) => (i === 0 ? x : x * k + prev * (1 - k)), values[0]);
}

export function rsi(closes, period = 14) {
  let gain = 0, loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export const AGENTS = [
  {
    name: 'NOVA', role: 'momentum',
    run(c) {
      const chg = (c.at(-1).c - c.at(-2).c) / c.at(-2).c * 100;
      if (chg >= 0.05) return { vote: 1, note: `close +${chg.toFixed(2)}%` };
      if (chg <= -0.05) return { vote: -1, note: `close ${chg.toFixed(2)}%` };
      return { vote: 0, note: 'chop' };
    },
  },
  {
    name: 'ORIN', role: 'RSI filter',
    run(c) {
      const r = rsi(c.map((x) => x.c));
      if (r > 70 || r < 30) return { vote: 0, veto: true, note: `RSI ${r.toFixed(0)} extreme` };
      return { vote: r > 50 ? 1 : -1, note: `RSI ${r.toFixed(0)}` };
    },
  },
  {
    name: 'VELA', role: 'EMA trend',
    run(c) {
      const cl = c.map((x) => x.c);
      const f = ema(cl.slice(-40), 9), s = ema(cl.slice(-60), 21);
      return { vote: f > s ? 1 : -1, note: `EMA9 ${f > s ? '>' : '<'} EMA21` };
    },
  },
  {
    name: 'KADE', role: 'volume',
    run(c) {
      const avg = mean(c.slice(-21, -1).map((x) => x.v));
      const ratio = c.at(-1).v / avg;
      const up = c.at(-1).c >= c.at(-1).o;
      if (ratio >= 1.5) return { vote: up ? 1 : -1, note: `vol x${ratio.toFixed(1)}` };
      return { vote: 0, note: `vol x${ratio.toFixed(1)}` };
    },
  },
  {
    name: 'RUNE', role: 'bollinger',
    run(c) {
      const cl = c.slice(-20).map((x) => x.c);
      const m = mean(cl), sd = Math.sqrt(mean(cl.map((x) => (x - m) ** 2)));
      const z = sd ? (cl.at(-1) - m) / sd : 0;
      if (z <= -2) return { vote: 1, note: `z ${z.toFixed(1)} lower band` };
      if (z >= 2) return { vote: -1, note: `z ${z.toFixed(1)} upper band` };
      return { vote: 0, note: `z ${z.toFixed(1)}` };
    },
  },
  {
    name: 'ZARA', role: 'risk guard',
    run(c) {
      const ranges = c.slice(-30).map((x) => (x.h - x.l) / x.c * 100);
      const cur = ranges.at(-1), avg = mean(ranges.slice(0, -1));
      if (cur > avg * 3) return { vote: 0, veto: true, note: `volatility x${(cur / avg).toFixed(1)}` };
      return { vote: 0, note: 'volatility ok' };
    },
  },
];

/** Long-only consensus (spot): enter when >= minVotes agents are bullish and nobody vetoes. */
export function consensus(results, minVotes = 3) {
  const bull = results.filter((r) => r.vote === 1).length;
  const bear = results.filter((r) => r.vote === -1).length;
  const veto = results.find((r) => r.veto);
  return { bull, bear, veto: veto ? veto.agent : null, enter: !veto && bull >= minVotes && bull > bear };
}
