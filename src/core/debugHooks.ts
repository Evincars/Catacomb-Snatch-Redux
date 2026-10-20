/**
 * Developer-only handles on live game state, for poking at it from the browser console. Nothing is
 * exposed in production builds or outside a browser.
 */
export function exposeForDebugging(hooks: Readonly<Record<`__${string}`, unknown>>): void {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return;
  Object.assign(window, hooks);
}
