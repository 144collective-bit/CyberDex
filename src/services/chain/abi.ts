/**
 * Minimal ERC-20 call encoding.
 *
 * Selectors are the well-known keccak prefixes for the standard signatures; we
 * hard-code them rather than pulling in a hashing dependency for six methods.
 */
export const SELECTORS = {
  balanceOf: '0x70a08231', // balanceOf(address)
  allowance: '0xdd62ed3e', // allowance(address,address)
  approve: '0x095ea7b3', // approve(address,uint256)
  decimals: '0x313ce567', // decimals()
  symbol: '0x95d89b41', // symbol()
  transfer: '0xa9059cbb', // transfer(address,uint256)
} as const;

export const MAX_UINT256 = (2n ** 256n - 1n).toString();

export function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

export function padUint(value: bigint | string | number): string {
  const asBig = typeof value === 'bigint' ? value : BigInt(value);
  return asBig.toString(16).padStart(64, '0');
}

export function encodeBalanceOf(owner: string): string {
  return SELECTORS.balanceOf + padAddress(owner);
}

export function encodeAllowance(owner: string, spender: string): string {
  return SELECTORS.allowance + padAddress(owner) + padAddress(spender);
}

export function encodeApprove(spender: string, amount: bigint | string): string {
  return SELECTORS.approve + padAddress(spender) + padUint(amount);
}

export function decodeUint(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

/** Base-unit string → human number. Display only; never used for math on-chain. */
export function fromBaseUnits(raw: string | bigint, decimals: number): number {
  const asBig = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  const divisor = 10n ** BigInt(decimals);
  const whole = asBig / divisor;
  const remainder = asBig % divisor;
  return Number(whole) + Number(remainder) / Number(divisor);
}

/** Human number → base-unit string, without floating point drift in the integer part. */
export function toBaseUnits(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const [whole = '0', fraction = ''] = amount.toFixed(Math.min(decimals, 18)).split('.');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${paddedFraction}`.replace(/^0+(?=\d)/, '');
  return combined === '' ? '0' : combined;
}

/* ---------------------------------------------------------------- AMM reads */

export const AMM_SELECTORS = {
  getReserves: '0x0902f1ac', // getReserves()
  token0: '0x0dfe1681', // token0()
  token1: '0xd21220a7', // token1()
  getPair: '0xe6a43905', // getPair(address,address)
  getAmountsOut: '0xd06ca61f', // getAmountsOut(uint256,address[])
  totalSupply: '0x18160ddd', // totalSupply()
} as const;

export function encodeGetReserves(): string {
  return AMM_SELECTORS.getReserves;
}

export function encodeGetPair(tokenA: string, tokenB: string): string {
  return AMM_SELECTORS.getPair + padAddress(tokenA) + padAddress(tokenB);
}

/**
 * getAmountsOut(uint256 amountIn, address[] path).
 *
 * Head is the amount plus the offset to the dynamic array; tail is the array
 * length followed by one word per hop.
 */
export function encodeGetAmountsOut(amountIn: bigint | string, path: string[]): string {
  const head = padUint(amountIn) + padUint(64); // array data starts after two words
  const tail = padUint(path.length) + path.map((address) => padAddress(address)).join('');
  return AMM_SELECTORS.getAmountsOut + head + tail;
}

function words(hex: string): string[] {
  const body = hex.replace(/^0x/, '');
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

export interface Reserves {
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
}

/** Decode getReserves() → (uint112, uint112, uint32). */
export function decodeReserves(hex: string): Reserves | null {
  const parts = words(hex);
  if (parts.length < 3) return null;
  return {
    reserve0: BigInt(`0x${parts[0]}`),
    reserve1: BigInt(`0x${parts[1]}`),
    blockTimestampLast: Number(BigInt(`0x${parts[2]}`)),
  };
}

/** Decode a single returned address, or null for the zero address. */
export function decodeAddress(hex: string): string | null {
  const parts = words(hex);
  if (!parts.length) return null;
  const address = `0x${parts[0]!.slice(24)}`;
  return /^0x0{40}$/.test(address) ? null : address;
}

/** Decode getAmountsOut → uint256[]. */
export function decodeAmounts(hex: string): bigint[] {
  const parts = words(hex);
  // [offset, length, ...values]
  if (parts.length < 2) return [];
  const length = Number(BigInt(`0x${parts[1]}`));
  return parts.slice(2, 2 + length).map((word) => BigInt(`0x${word}`));
}
