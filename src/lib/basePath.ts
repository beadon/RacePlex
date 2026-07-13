/**
 * Resolve a `public/` asset against the base path the app was built for.
 *
 * RacePlex is served from the root on most hosts (a local `bun run dev`,
 * Cloudflare Workers, an nginx box) but from a **subpath** on a GitHub Pages
 * project site — `https://<user>.github.io/RacePlex/`. Vite bakes the deployed
 * base into `import.meta.env.BASE_URL` at build time, always with a trailing
 * slash (`"/"` or `"/RacePlex/"`).
 *
 * A hardcoded `fetch("/tracks.json")` therefore resolves to
 * `https://<user>.github.io/tracks.json` on Pages — outside the deployment, a
 * 404, and the tracks list silently comes up empty. Everything served out of
 * `public/` has to go through here.
 *
 * Module imports and `<img src>` in JSX don't: Vite rewrites those itself. This
 * is only for URLs the app builds as strings at runtime.
 */
export function assetUrl(path: string): string {
  // BASE_URL always ends in "/", so strip any leading slash off the path to
  // avoid "//tracks.json".
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}
