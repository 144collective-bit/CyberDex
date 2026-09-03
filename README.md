# CYBER DEX

**A modular DeFi trading operating system.** Not a DEX front-end — a workspace where you
assemble your own trading terminal out of independent modules, wire them together, and
run trades through a pluggable routing layer.

```
PAIR SELECTOR ──▶ CHART · PRICE · SWAP · RATIO
WALLET ──▶ PORTFOLIO ──▶ 25% CALCULATOR ──▶ SWAP AMOUNT ──▶ TRADE
```

Nothing in the UI hard-codes those relationships. A module declares typed inputs and
outputs; the deck's link graph decides what feeds what.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5199
npm test           # 97 unit + integration tests
npm run build      # typecheck + production build
npm run preview    # serve the production build on :5200
```

The dev server deliberately avoids Vite's default 5173, which another project is
usually already sitting on. Override with `npm run dev -- --port 4000` if 5199 is
taken. If a stale app still appears at the URL, it is a service worker or cache
from whatever ran on that port before — hard-reload, or clear site data for that
origin in DevTools → Application → Storage. The page title should read
`CYBER DEX // MODULAR TRADING OS`.

First launch offers **CONNECT WALLET** or **EXPLORE DEMO**. Demo mode simulates market
data and transactions, and labels every simulated value as such.

---

## The five concepts

| Concept | Meaning |
| --- | --- |
| **MODULE** | A self-contained unit of UI + data + interaction (wallet, chart, swap…). |
| **INPUT / OUTPUT** | Typed ports. `pair`, `token`, `wallet`, `amount`, `price`, `quote`, `signal`… |
| **LINK** | A connection from one module's output to another's input. |
| **CIRCUIT** | A group of linked modules forming a reusable workflow. |
| **DECK** | A saved workspace: modules, positions, links, config, network, wallet. |

## Architecture

```
src/
  core/         module model, registry, port types, deck reducer, link graph,
                event bus, runtime output store, storage adapters, deck schema
  services/     market data (demo · on-chain · indexer, behind one switch) ·
                http · json-rpc · chain · DEX routing · wallet · portfolio ·
                execution · alerts · telemetry · notifications
                (all interface-first)
  modules/      declarative module definitions + lazy-loaded components
  components/   desk (frames, ports, links, library) and shell (bar, rail, palette)
  state/        React bindings: system provider, deck hooks, module IO hooks
  pages/        decks · markets · wallets · circuits · alerts · transactions · settings
```

Four rules the code holds to:

1. **No module imports another module.** Data moves through ports and the event bus.
2. **Providers are interfaces.** `MarketDataProvider`, `ChainProvider`, `DexAdapter`,
   `PersistenceAdapter` each have a demo implementation and a documented contract; a live
   indexer or a new venue is a new implementation, not a UI change.
3. **Business logic lives outside components.** Quote ranking, trade safety, alert
   conditions, deck mutation and link validation are pure and unit-tested.
4. **Real data and demo data never blur.** Every simulated value carries `simulated: true`
   and is labelled in the UI. Simulated transaction hashes are prefixed `sim:`.

### Event bus

Modules publish and subscribe by name (`PAIR_CHANGED`, `QUOTE_UPDATED`,
`TRANSACTION_CONFIRMED`, `ALERT_TRIGGERED`…). The bus keeps a bounded history, which is
what the Activity Log module and the status bar read.

### Polling and rendering cost

A module subscribes only to the upstream modules it is linked to, through
`ModuleRuntime` + `useSyncExternalStore`. A price tick re-renders the price module and its
subscribers — not the deck. Module components are code-split: each ships as its own chunk
and loads when a deck first places it.

Network telemetry (gas, block, RPC/indexer/router health) runs through `TelemetryService`:
one poller per chain, started by the first subscriber and stopped by the last, no matter
how many modules and chrome elements display it. Adding a second Gas module costs nothing.

Persistence is honest about failure. If a write is rejected — quota exhausted, private
browsing — the adapter reports it, keeps the session alive in memory, and the UI says so;
a save that did not reach storage is never announced as saved.

## Modules (24)

**Market** price · chart (candles/line, volume, crosshair, zoom) · liquidity
**Tokens** pair selector · token selector · token info · watchlist
**Wallet** wallet · portfolio · asset allocation · transactions
**Trading** swap terminal · quote comparison
**Analytics** calculator · price ratio
**Intelligence** alert · whale watch · market scanner
**Staking** HEX stakes (T-share + ladder)
**Network** gas · network status
**System** activity log · notes · clock

## Trading safety

- The swap terminal is the only `EXECUTION_CAPABLE` module. Its two sides follow the
  linked pair by default; flipping the direction or picking a token pins the module (shown
  as `PINNED ↺`, one click to follow the pair again), and a token wired into TOKEN A or
  TOKEN B always wins over a local pick.
- Flow is quote → review → explicit confirm. `ExecutionService` refuses a trade that
  skips review, was not confirmed, still needs an approval, or carries a blocking warning.
- A **watch wallet** can never sign; the guard is in the service, not the UI.
- The confirmation screen shows source, destination, amounts, minimum received, slippage,
  price impact, route, path, protocol, contract address, wallet, network, gas and
  simulation result — with estimates labelled as estimates.
- Warnings cover price impact, thin liquidity, extreme slippage, unverified tokens,
  insufficient balance or gas, unsupported network, failed simulation and pending approval.
- No seed phrase or private key is ever requested, stored or transmitted. Signing is
  delegated to the wallet provider over EIP-1193.

## Decks

Save, rename, duplicate, delete, export and import. The deck format is versioned JSON:

```json
{ "version": "1.0", "app": "cyber-dex", "deck": { "name": "HEX WAR ROOM", "modules": [], "connections": [], "settings": {} } }
```

Import is defensive: unknown module types are dropped with a warning rather than failing
the file, and modules written by an older version are migrated forward (missing config
keys are backfilled from the current definition).

Templates: **GENESIS · TRADER · PORTFOLIO · HEX COMMAND · WHALE HUNTER · BALANCE CIRCUIT**.

## Market data

Three feeds, switched in **Settings → Market feed**, all behind the same fallback:

| Feed | Source | Has history? |
| --- | --- | --- |
| **DEMO** (default) | seeded simulation | yes, synthetic |
| **ON-CHAIN** | PulseChain AMM reserves | no |
| **INDEXER** | GeckoTerminal public API | yes |

**On-chain is the authoritative one.** Prices come from `getReserves()` on the PulseX
pairs — the same state the router trades against, with no third party in between — and USD
is anchored by routing through WPLS to a stable pool. Every read in a refresh is pinned to
one block number, so a set of prices is a coherent snapshot rather than several moments
stitched together. Quotes come from the router's own `getAmountsOut`, and price impact from
the pool's reserves, so the number shown is the number the chain would produce.

What the chain cannot give cheaply is history. Candles and 24h aggregates need log
indexing, so on this feed `getOHLC` returns nothing and the chart shows its empty state
rather than inventing a series. Point it at an indexer when you have one.

`JsonRpcClient` holds several RPC endpoints, batches calls into one request, fails over
when one stops answering and lets it back in after a cooldown. A contract revert is
distinguished from a dead endpoint, so a bad token never marks a healthy node unhealthy.
Contract addresses live in `services/chain/chainConfig.ts` — **verify them against an
explorer before trusting a deployment**; a wrong router means a broken quote, and a wrong
stable pair means a wrong USD price everywhere.

`ResilientMarketProvider` wraps each live feed with the demo feed behind it. After two
consecutive failures it switches over, raises one notice, flips `origin` to `demo` so every
module shows its DEMO badge, and reports `degraded` health. `recheck()` returns to live and
says so. A quote that has not refreshed within 90s is marked STALE.

> The GeckoTerminal adapter and the PulseChain reads are written against documented shapes
> and covered by fixture tests, but neither has been exercised against a live endpoint —
> the build environment blocks outbound HTTP. Expect one local run to confirm.

To add a backend, implement `MarketDataProvider` and register it in `createSystem`. No
module changes: modules only know the interface.

## The chart

Hand-drawn SVG rather than a charting dependency, so it resizes with its module,
uses the terminal's own tokens, and stays cheap enough to run several per deck.

- **Both axes are labelled.** Price ticks are snapped to 1, 2, 2.5 or 5 times a
  power of ten, and the gridlines are drawn on those ticks — so a line means a
  number, rather than sitting at an arbitrary fraction of the height. Each label
  carries only the decimals its own step resolves: a gridline every 10 reads
  `120`, not `120.0000`, while a 0.25 step keeps both places so neighbouring
  ticks stay distinguishable. Sub-milli prices fall back to subscript notation.
- **Time labels match the timeframe** — clock times intraday, dates on the daily
  and weekly, since a weekly chart labelled with clock times says 00:00 all the
  way across. The end labels anchor inward instead of being clipped by the frame.
- **The crosshair is measured, not decorative.** It tags its own price on the
  price axis and its own time on the time axis, alongside the OHLC readout.
- **The last close is tagged** on the axis in the direction colour of the final
  candle.
- **Moving averages** overlay as MA 7/25 or MA 25/99. Positions before the window
  is full are drawn as nothing rather than a partial average — an MA(25) from
  three candles is not an MA(25).
- Series are cached for 20s, keyed by feed, pair, timeframe and limit, and shared
  across every chart on the deck. Flipping a timeframe and coming back is free,
  two charts on the same pair are one request, and the feed in the key means one
  feed's candles can never appear under another's name. Empty answers are not
  cached — that is a result to retry, not to remember.

At 260×170 it degrades to one price tick and two time labels rather than
crowding; the last-price tag survives at every size.

## Moving modules

Dragging a module by its header is the primary way a deck gets built, so the gesture is
deliberate about what it does:

- **Alignment guides.** While dragging, edges and centres snap magnetically to nearby
  modules (left↔left, right↔right, centre↔centre, and flush against an edge) and the
  matching guide line is drawn. Out in open space it falls back to the deck's grid.
- **Swap.** Dropping a module onto the middle of another exchanges their slots — position
  and size — with a SWAP marker on the target while you hold it there. The outer fifth of
  a module is a normal drop zone, so nudging one up against its neighbour never swaps by
  accident. Links are unaffected; a locked module keeps its slot.
- **Escape cancels** an in-flight drag and the module returns to where it started.
- **Arrow keys** nudge the selected module one grid step, or one pixel with Shift.
- **Edge auto-scroll.** Dragging toward the edge scrolls the desk, and the module keeps
  tracking the cursor as the canvas moves under it.
- Every completed drag, swap or nudge is one undo step.

## Controls and keyboard

Every control in the app comes from one small set: `Button` / `IconButton`, `Segmented`
for mutually exclusive choices, and `Menu` for dropdowns. Appearance is driven entirely by
data attributes against design tokens, so themes and density need no component changes.

- **Menus** (deck, network, wallet, module header) open on click or `Enter`/`↓`, move with
  `↑ ↓ Home End`, select with `Enter`, close on `Esc` returning focus to the trigger, and
  expose `menu`/`menuitem` roles.
- **Segmented controls** (timeframes, filters, sort, slippage, theme, density) are radio
  groups: `← →` moves between segments and carries focus with the selection.
- **Rail** collapses to icons and shows each destination's name as a tooltip; the active
  route gets a marker bar, not just a colour change.

`⌘/Ctrl + K` command palette · `⌘/Ctrl + M` module library · `⌘/Ctrl + S` save deck ·
`⌘/Ctrl + D` new deck · `⌘/Ctrl + Z` undo · `⇧⌘/Ctrl + Z` redo ·
`L` link mode · `+` / `-` zoom · `0` reset to 100% · `F` fit deck on screen ·
`Delete` remove selected module or link · `Esc` close.

### Getting around a large deck

A deck stops fitting on one screen quickly, and scrollbars alone make a big
workspace feel like a keyhole:

- **Zoom** runs on fixed stops (35% → 200%) rather than free scaling, so the
  control can always say something as useful as "100%". `⌘/Ctrl + wheel` zooms
  about the cursor — the canvas point under the pointer stays under it — and the
  buttons and keys zoom about the centre of the view.
- **Fit** (`F`) picks the zoom that puts the whole deck on screen and centres it,
  never magnifying past 100%: a three-module deck sits at its natural size.
- **Go to** lists every module on the deck and scrolls to the one you pick.
- **Minimap**, bottom right, draws the whole deck with the on-screen area on top;
  click or drag it to move around.
- **Middle-button drag** pans the canvas from anywhere, since the left button
  belongs to modules and ports.

The grid is drawn on the canvas rather than the viewport, so it scrolls and
scales with the deck — halved squares are the plainest possible read on the
current zoom. Pointer and scroll deltas are divided by the scale before they
reach the drag maths, so dragging, snapping and swapping are as accurate at 50%
as at 100%.

### Reading the deck

A circuit you cannot see is a circuit you cannot debug, so the ports are made findable
rather than discoverable by accident:

- **Link mode** (`L`, or the button on the desk toolbar) enlarges every port on every
  module and shows its label, turning the deck into a wiring diagram for as long as you
  hold the mode. Selecting a single module reveals just that module's port labels.
- **Numbers are typed, not uniform.** A `.value` carries a size step — the price a module
  exists to show is `xl`, its supporting figures are `sm` — so a module has one obvious
  subject. Values are tabular-figure aligned and never uppercased.
- **Sub-cent prices use subscript-zero notation**: `$0.0₄3561` instead of `$0.000035610`,
  the convention traders already read. Four significant digits survive at any magnitude.
- **Price changes flash** green up / red down for a beat on the value itself, so a tick is
  visible without watching the number. The flash never fires on first render, only on a
  real change.

Undo covers every deck edit — deleting a module restores it with all of its links.
Continuous edits (typing in Notes, dragging a module) collapse into one step, and
switching deck or raising a module is not treated as an edit.

### Contrast

Secondary text is the easiest thing to lose in a dark theme. `--text-muted` was measured
against `--surface-1` in every theme and raised until all four clear WCAG AA for body
text — cyber-dark 5.35:1, cyber-green 5.86:1, cyber-amber 5.10:1, ice 5.64:1. The
measurement is a browser check against the computed tokens, not an eyeball.

## Tests and CI

`.github/workflows/ci.yml` runs typecheck, tests and the production build on every push
and pull request, and writes the per-chunk bundle size into the run summary.

```
core       event bus · port compatibility · deck reducer · link graph · runtime store ·
           persistence · deck import/export + migration
services   routing + trade-safety assessment · execution guards · wallet rules ·
           alert engine · notifications · demo market · portfolio composition
app        the full MVP workflow (add → link → select pair → quote → review → confirm →
           feed → reload), every deck template's wiring, undo/redo semantics,
           telemetry poller sharing, alert-rule ownership, storage degradation
```

## Status

Working today: desk, module engine, links, decks, persistence, demo market data, wallet
connection (injected / demo / watch), portfolio, swap with routing and safety checks,
transactions, alerts, circuits, command palette, themes.

Deliberately not built yet — the architecture leaves room for each: limit orders, DCA,
automated strategies, backtesting, cross-chain routing, hardware wallets, deck sharing and
an AI deck builder (module definitions are already declarative and machine-readable).

Market data and transactions in demo mode are simulated. Wire a live `MarketDataProvider`
and use an injected wallet for real execution.
