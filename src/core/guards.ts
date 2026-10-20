/** Type guards for data from outside the program (saves, network packets, settings), so it is checked, not cast. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `key` is an own property of `object`; narrows the key to the object's own key type. */
export function hasKey<T extends object>(object: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber);
}
