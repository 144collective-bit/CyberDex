import type { EventBus } from '../../core/events/bus';
import type { Address, PortfolioSnapshot, TokenBalance } from '../../core/types';
import type { ChainProvider } from '../chain/ChainProvider';
import type { MarketDataProvider } from '../market/MarketDataProvider';
import { tokensForChain } from '../market/tokens';

/**
 * Composes balances (chain) with prices (market) into one snapshot.
 *
 * This is why neither provider knows about the other: the chain adapter returns
 * `valueUsd: 0` and pricing is applied here, in one place.
 */
export class PortfolioService {
  private cache = new Map<string, { snapshot: PortfolioSnapshot; at: number }>();
  private ttlMs: number;
  private bus: EventBus;

  constructor(bus: EventBus, ttlMs = 15_000) {
    this.bus = bus;
    this.ttlMs = ttlMs;
  }

  async load(
    address: Address,
    chain: ChainProvider,
    market: MarketDataProvider,
    options: { force?: boolean } = {},
  ): Promise<PortfolioSnapshot> {
    const key = `${chain.chainId}:${String(address).toLowerCase()}`;
    const cached = this.cache.get(key);
    if (!options.force && cached && Date.now() - cached.at < this.ttlMs) return cached.snapshot;

    const tokens = tokensForChain(chain.chainId);
    const [balances, markets] = await Promise.all([
      chain.getTokenBalances(address, tokens),
      market.getMarkets(tokens),
    ]);

    const priceBySymbol = new Map(markets.map((m) => [m.token.symbol, m]));
    const holdings: TokenBalance[] = balances
      .map((balance) => {
        const priced = priceBySymbol.get(balance.token.symbol);
        return { ...balance, valueUsd: balance.amount * (priced?.priceUsd ?? 0) };
      })
      .filter((balance) => balance.amount > 0)
      .sort((a, b) => b.valueUsd - a.valueUsd);

    const totalValueUsd = holdings.reduce((acc, h) => acc + h.valueUsd, 0);
    // Portfolio change is the value-weighted change of its holdings.
    const weighted = (field: 'change24hPct' | 'change7dPct') =>
      totalValueUsd === 0
        ? 0
        : holdings.reduce((acc, h) => {
            const priced = priceBySymbol.get(h.token.symbol);
            return acc + (priced?.[field] ?? 0) * (h.valueUsd / totalValueUsd);
          }, 0);

    const snapshot: PortfolioSnapshot = {
      address,
      chainId: chain.chainId,
      totalValueUsd,
      change24hPct: weighted('change24hPct'),
      change7dPct: weighted('change7dPct'),
      holdings,
      updatedAt: Date.now(),
      simulated: chain.origin === 'demo' || market.origin === 'demo',
    };

    this.cache.set(key, { snapshot, at: Date.now() });
    this.bus.emit('PORTFOLIO_UPDATED', { snapshot }, 'portfolio-service');
    return snapshot;
  }

  invalidate(address?: Address): void {
    if (!address) {
      this.cache.clear();
      return;
    }
    for (const key of Array.from(this.cache.keys())) {
      if (key.endsWith(String(address).toLowerCase())) this.cache.delete(key);
    }
  }
}
