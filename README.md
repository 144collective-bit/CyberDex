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
  services/     market data · chain · DEX routing · wallet · portfolio ·
                execution · alerts · notifications   (all interface-first)
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

### Rendering cost

A module subscribes only to the upstream modules it is linked to, through
`ModuleRuntime` + `useSyncExternalStore`. A price tick re-renders the price module and its
subscribers — not the deck. Module components are code-split: each ships as its own chunk
and loads when a deck first places it.

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
`⌘/Ctrl + D` new deck · `Delete` remove selected module or link · `Esc` close.

## Tests

```
core       event bus · port compatibility · deck reducer · link graph · runtime store ·
           persistence · deck import/export + migration
services   routing + trade-safety assessment · execution guards · wallet rules ·
           alert engine · notifications · demo market · portfolio composition
app        the full MVP workflow (add → link → select pair → quote → review → confirm →
           feed → reload) and every deck template's wiring
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
