/** Prefixes a root-relative public path with the deployment base (e.g. /Catacomb-Snatch-Redux/ on GitHub Pages). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  return base + path.replace(/^\//, '');
}
