/**
 * Port type system.
 *
 * Ports are the only contract between modules. A module never imports another
 * module: it declares typed inputs/outputs and the deck's link graph wires
 * them. Compatibility is decided here and nowhere else.
 */

export type PortDataType =
  | 'token'
  | 'pair'
  | 'wallet'
  | 'address'
  | 'amount'
  | 'price'
  | 'ratio'
  | 'number'
  | 'percent'
  | 'timeframe'
  | 'network'
  | 'signal'
  | 'quote'
  | 'transaction'
  | 'balance'
  | 'series'
  | 'text'
  | 'any';

export interface PortSpec {
  id: string;
  label: string;
  type: PortDataType;
  description?: string;
  /** Inputs only: module still works without a link. */
  optional?: boolean;
}

/**
 * Coercions that are safe to allow when wiring an output into an input.
 * Key = source (output) type, value = input types it may drive.
 */
const COERCIONS: Record<PortDataType, PortDataType[]> = {
  token: ['token'],
  pair: ['pair'],
  wallet: ['wallet', 'address'],
  address: ['address'],
  amount: ['amount', 'number'],
  price: ['price', 'number'],
  ratio: ['ratio', 'number'],
  number: ['number', 'amount', 'price', 'ratio', 'percent'],
  percent: ['percent', 'number'],
  timeframe: ['timeframe'],
  network: ['network'],
  signal: ['signal'],
  quote: ['quote'],
  transaction: ['transaction'],
  balance: ['balance', 'number', 'amount'],
  series: ['series'],
  text: ['text'],
  any: [],
};

export function canConnect(source: PortDataType, target: PortDataType): boolean {
  if (source === 'any' || target === 'any') return true;
  if (source === target) return true;
  return (COERCIONS[source] ?? []).includes(target);
}

export function portTone(type: PortDataType): string {
  switch (type) {
    case 'signal':
    case 'transaction':
      return 'warning';
    case 'quote':
      return 'info';
    default:
      return 'accent';
  }
}
