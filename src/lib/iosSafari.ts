/**
 * Detect iOS Safari — there is no capability-based way to ask "did the OS
 * settings block this," so when a `permission-denied` geolocation error
 * fires (see `lib/gps/customGps.ts`), the Lap Timer tool uses this to decide
 * whether to show iOS's specific re-enable path instead of a generic message.
 * The Settings app is unreachable from a web page, so this is guidance text,
 * not an automated fix.
 *
 * iPadOS reports as "Macintosh" in its UA unless "Request Desktop Website" is
 * off, so `maxTouchPoints` disambiguates a touch Mac (iPad) from a real one.
 */
export function isIosSafari(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  const ua = nav.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  if (!isIosDevice) return false;
  // Every iOS browser (Chrome, Firefox, …) embeds WebKit and includes "Safari"
  // in its UA, but only actual Safari lacks a "CriOS"/"FxiOS"/etc. token.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}
