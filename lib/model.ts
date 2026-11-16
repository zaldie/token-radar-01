// Token radar model radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the
// ceiling) plus every rankable pre-token protocol below the floor — the early
// rows the radar exists to find. A protocol is pre-token when its record carries
// no token (no market cap, no CoinGecko id, no symbol); live-token protocols are
// kept apart and shown at the market's own value, never ranked in the board.
//
// Implied value follows only from the snapshot's own figures:
//
//   base     = tvl_usd x 0.25
//   growth   = clamp(change_7d, -60, +60) per cent
//   growth   = 1 + 0.5 x growth/100 when growth <= 0
//            = 1 + 0.4 x growth/100 when growth > 0
//              (a hot week is noisy, a cold week is a warning; a +4448% week
//               caps at +24%)
//   maturity = 0.6 + 0.4 x (1 - exp(-age_days / 365))
//              (most credit in year one, then a plateau; unknown age = 180 days)
//   reach    = 1 + 0.02 x min(chains - 1, 5)   (max 1.10)
//   implied  = max(1, round(base x growth x maturity x reach))
//
// No protocol name is ever special-cased: the same function scores every row,
// and every farm plan is generated from the protocol's own category, chains,
// TVL and age.

/** One protocol entry of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The radar-2 constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight_up: number;
  growth_weight_down: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight_up: 0.4,
  growth_weight_down: 0.5,
  growth_floor: -60,
  growth_cap: 60,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 365,
  unknown_age_days: 180,
  reach_per_chain: 0.02,
  reach_max_chains: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One board row in the compact form data.js carries, farm steps included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface ScoredValue {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  reachMult: number;
  age: number | null;
}

/** The multipliers and the implied value one protocol gets under radar-2. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants): ScoredValue {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct <= 0 ? model.growth_weight_down : model.growth_weight_up;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.maturity_days));
  const extraChains = Math.max(0, protocol.chains.length - 1);
  const reachMult = 1 + model.reach_per_chain * Math.min(extraChains, model.reach_max_chains);
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * reachMult));
  return { implied, growthPct, growthMult, maturityMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, whatever its TVL.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, by TVL.
  // No cap: on this snapshot that is 186 rows, so the board is 40 + 186 = 226.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      reach_multiplier: round4(s.v.reachMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** One step as a single string: action, cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Cheap chains where a weekly action costs almost nothing. */
const CHEAP_L2 = new Set([
  'Arbitrum',
  'Base',
  'Blast',
  'Fraxtal',
  'Ink',
  'Linea',
  'Mantle',
  'Metis',
  'Mode',
  'Optimism',
  'Polygon',
  'Polygon zkEVM',
  'Scroll',
  'Soneium',
  'Starknet',
  'Taiko',
  'Unichain',
  'Zircuit',
  'zkSync Era',
]);

/** The gas note for one chain, so the plan states what each action costs there. */
function gasNote(chain: string): { text: string; cost: string } {
  if (chain === 'Ethereum') {
    return {
      text: `Expect about $5–15 of gas per transaction on Ethereum, so batch your actions and farm during quiet hours instead of paying peak fees.`,
      cost: 'about $5–15 of gas per transaction',
    };
  }
  if (chain === 'Solana') {
    return {
      text: `Solana fees run under $0.10 per transaction, so the weekly actions in this plan cost almost nothing in gas.`,
      cost: 'under $0.10 of gas per transaction',
    };
  }
  if (CHEAP_L2.has(chain)) {
    return {
      text: `Fees on ${chain} usually stay under $1 per transaction, so a weekly action costs less than a coffee in gas.`,
      cost: 'under $1 of gas per transaction',
    };
  }
  return {
    text: `Expect roughly $1–3 of gas per transaction on ${chain}, and check the fee before each weekly action.`,
    cost: 'about $1–3 of gas per transaction',
  };
}

interface CategoryPlan {
  action: string;
  weekly: string;
}

/** The category's entry action and its weekly qualifying action, from the category alone. */
function planFor(p: SnapshotProtocol, capital: number, chain: string): CategoryPlan {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return {
      action: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and swap a small amount through it, then keep the position open.`,
      weekly: `Swap a small amount through ${name} and add or rebalance a little liquidity so the week counts as active.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      action: `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and keep both sides open.`,
      weekly: `Repay a little of the borrow and borrow again, or top up the supply, so the week counts as active.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      action: `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`,
      weekly: `Bridge a small amount through ${name} again and use the funds on the destination chain.`,
    };
  }
  if (c.includes('liquid staking') || c.includes('staking pool') || c.includes('restak')) {
    return {
      action: `Stake $${capital} of the chain's staking asset through ${name} on ${chain}, keep the receipt token, and use it in one DeFi app.`,
      weekly: `Restake the rewards or top up the stake a little, and keep the receipt token working in DeFi.`,
    };
  }
  if (c.includes('risk curator') || c.includes('onchain capital') || c.includes('allocator')) {
    return {
      action: `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares for the whole farming window.`,
      weekly: `Check the vault's yield, deposit a little more or move between its vaults once.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      action: `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the whole farming window.`,
      weekly: `Check the yield accrued, claim it if the protocol offers it, and hold the asset.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis trading')) {
    return {
      action: `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedge, then keep the margin posted.`,
      weekly: `Open and close one small hedge so the week counts as active, keeping the margin posted.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) {
    return {
      action: `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the vault shares for the whole farming window.`,
      weekly: `Harvest the yield or compound it back into the vault once a week.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      action: `Fund $${capital} on ${name} on ${chain} and place one market position, then keep funds on the platform.`,
      weekly: `Place one new market position and settle or close an old one.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      action: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the whole farming window.`,
      weekly: `Check the policy and the protocol's rewards page, and renew or extend the cover if it lapses.`,
    };
  }
  if (c.includes('stablecoin') || c.includes('stable')) {
    return {
      action: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it for the whole farming window.`,
      weekly: `Mint a little more or move the stable asset between the protocol's pools once.`,
    };
  }
  if (c.includes('governance')) {
    return {
      action: `Deposit $${capital} into ${name} on ${chain} and lock it in the governance vault if one is offered.`,
      weekly: `Vote on one live proposal, or deposit a little more if no vote is open.`,
    };
  }
  if (c.includes('index')) {
    return {
      action: `Buy $${capital} of ${name}'s index token on ${chain} and hold it for the whole farming window.`,
      weekly: `Check the index rebalance and top up the position a little if the mix changed.`,
    };
  }
  if (c.includes('payment') || c.includes('card')) {
    return {
      action: `Deposit $${capital} into ${name} on ${chain} and pay for one real purchase or transfer through it.`,
      weekly: `Make one payment or transfer through ${name} so the week counts as active.`,
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the whole farming window.`,
    weekly: `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * Derived from the protocol's own record (category, chains, TVL, age) — never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const plan = planFor(p, capital, chain);
  const gas = gasNote(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase written down offline, never in a screenshot or a chat.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: plan.action, cost: `$${capital} of capital and a few dollars of gas`, time: '15 minutes to set up' },
    { text: plan.weekly, cost: gas.cost, time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; never pay anyone to claim an airdrop for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    { text: gas.text, cost: gas.cost, time: '5 minutes a week to check fees' },
    {
      text: `Write the wallet address, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm steps included so the page shows the board's own plan. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
