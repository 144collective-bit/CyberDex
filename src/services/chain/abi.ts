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
