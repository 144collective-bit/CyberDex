import type { ModuleDefinition, ModuleInstance } from '../../core/modules/types';

export const HEADER_HEIGHT = 24;
export const PORT_SIZE = 13;

/** Visible height — a collapsed module is just its header. */
export function moduleHeight(module: ModuleInstance): number {
  return module.collapsed ? HEADER_HEIGHT : module.size.height;
}

/**
 * Vertical offset of port `index` of `count`, evenly distributed down the
 * module. The frame and the link layer both use this, so a wire always lands on
 * the dot it belongs to.
 */
export function portOffsetY(index: number, count: number, height: number): number {
  return (height * (index + 1)) / (count + 1);
}

export interface Point {
  x: number;
  y: number;
}

export function portPoint(
  module: ModuleInstance,
  definition: ModuleDefinition | undefined,
  portId: string,
  side: 'in' | 'out',
): Point | null {
  if (!definition) return null;
  const ports = side === 'in' ? definition.inputs : definition.outputs;
  const index = ports.findIndex((port) => port.id === portId);
  if (index < 0) return null;
  const height = moduleHeight(module);
  return {
    x: side === 'in' ? module.position.x : module.position.x + module.size.width,
    y: module.position.y + portOffsetY(index, ports.length, height),
  };
}

/** Cubic bezier that leaves an output horizontally and enters an input the same way. */
export function linkPath(from: Point, to: Point): string {
  const distance = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
}
