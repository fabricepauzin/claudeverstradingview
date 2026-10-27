/**
 * Paper-trading engine driven by REAL Bitget prices.
 * No orders are ever sent to an exchange: fills are simulated at the live
 * bid/ask with slippage and fees, so results stay honest and reproducible.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { AGENTS, consensus } from './agents.js';

const CFG = {
  startBalance: +process.env.START_BALANCE || 1000,
  feePct: 0.1,        // per side, Bitget spot taker
  slipPct: 0.05,
  sizePct: 10,        // % of equity per position
  tpPct: 0.4,
  slPct: 0.25,
  maxHoldBars: 15,
  minVotes: 3,
  maxLog: 60,
  maxEquity: 2880,    // ~48h at 1 point / minute
};

export function createEngine({ feed, symbols, statePath }) {
  const fresh = () => ({
    startedAt: Date.now(), cycle: 0, cash: CFG.startBalance, initial: CFG.startBalance,
    feesPaid: 0, positions: {}, trades: [], equity: [], log: [], agents: [], comms: 'waiting for first cycle',
  });
  let s = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : fresh();

  const log = (tag, msg) => {
    s.log.unshift({ t: Date.now(), tag, msg });
    s.log.length = Math.min(s.log.length, CFG.maxLog);
  };
  const save = () => {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(s));
  };
  const equityNow = (prices) =>
    s.cash + Object.entries(s.positions).reduce((a, [sym, p]) => a + p.qty * (prices[sym] ?? p.entry), 0);

  function open(sym, tk, why) {
    const px = tk.ask * (1 + CFG.slipPct / 100);
    const budget = Math.min(equityNow({ [sym]: tk.last }) * CFG.sizePct / 100, s.cash);
    if (budget < 5) return log('WARN', `${sym} skipped: not enough cash`);
    const fee = budget * CFG.feePct / 100;
    const qty = (budget - fee) / px;
    s.cash -= budget; s.feesPaid += fee;
    s.positions[sym] = { qty, entry: px, bars: 0, cost: budget };
    log('EXEC', `BUY ${qty.toPrecision(5)} ${sym} @ ${px.toFixed(px < 1 ? 5 : 2)} · ${why}`);
  }

  function close(sym, tk, why) {
    const p = s.positions[sym];
    const px = tk.bid * (1 - CFG.slipPct / 100);
    const gross = p.qty * px, fee = gross * CFG.feePct / 100;
    const pnl = gross - fee - p.cost;
    s.cash += gross - fee; s.feesPaid += fee;
    delete s.positions[sym];
    s.trades.push({ t: Date.now(), sym, pnl, win: pnl > 0 });
    log('FILL', `SOLD ${sym} ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)} · ${why}`);
  }

  async function cycle() {
    s.cycle++;
    const prices = {};
    for (const sym of symbols) {
      try {
        const [candles, tk] = await Promise.all([feed.candles(sym), feed.ticker(sym)]);
        const closed = candles.slice(0, -1); // drop in-progress candle
        prices[sym] = tk.last;
        const results = AGENTS.map((a) => ({ agent: a.name, ...a.run(closed) }));
        s.agents = AGENTS.map((a, i) => ({ name: a.name, role: a.role, ...results[i], sym }));
        const c = consensus(results, CFG.minVotes);
        const pos = s.positions[sym];

        if (pos) {
          pos.bars++;
          const chg = (tk.bid / pos.entry - 1) * 100;
          if (chg >= CFG.tpPct) close(sym, tk, `take profit ${chg.toFixed(2)}%`);
          else if (chg <= -CFG.slPct) close(sym, tk, `stop loss ${chg.toFixed(2)}%`);
          else if (pos.bars >= CFG.maxHoldBars) close(sym, tk, 'max hold');
          else if (c.bear > c.bull) close(sym, tk, 'consensus flipped');
        } else if (c.enter) {
          open(sym, tk, `${c.bull}/${AGENTS.length} agents bullish`);
        }
        s.comms = c.veto
          ? `${c.veto} veto on ${sym}`
          : `${sym}: ${c.bull} bull / ${c.bear} bear → ${c.enter ? 'ENTER' : 'hold'}`;
        log('SCAN', s.comms);
      } catch (e) {
        log('WARN', `${sym} feed error: ${e.message}`);
      }
    }
    s.equity.push([Date.now(), +equityNow(prices).toFixed(2)]);
    if (s.equity.length > CFG.maxEquity) s.equity.shift();
    save();
  }

  function snapshot(exchangeUsdt = null) {
    const wins = s.trades.filter((t) => t.win).length;
    const eq = s.equity.at(-1)?.[1] ?? s.initial;
    return {
      mode: 'PAPER', source: 'Bitget live prices', symbols,
      startedAt: s.startedAt, cycle: s.cycle,
      initial: s.initial, balance: eq, pnl: eq - s.initial, pnlPct: (eq / s.initial - 1) * 100,
      feesPaid: s.feesPaid, trades: s.trades.length, wins, losses: s.trades.length - wins,
      winRate: s.trades.length ? (wins / s.trades.length) * 100 : null,
      equity: s.equity, log: s.log, agents: s.agents, comms: s.comms,
      positions: s.positions, exchangeUsdt, cfg: CFG,
    };
  }

  return { cycle, snapshot };
}
