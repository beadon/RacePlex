import { describe, it, expect } from 'vitest';
import { isIosSafari } from './iosSafari';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_SAFARI = IPAD_SAFARI_DESKTOP_UA;
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

describe('isIosSafari', () => {
  it('true for actual Safari on iPhone', () => {
    expect(isIosSafari({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5 })).toBe(true);
  });

  it('false for Chrome on iPhone (embeds Safari in its UA, but has CriOS)', () => {
    expect(isIosSafari({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 })).toBe(false);
  });

  it('true for Safari on iPad reporting a Macintosh UA, when touch is present', () => {
    expect(isIosSafari({ userAgent: IPAD_SAFARI_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
  });

  it('false for real desktop Safari on a Mac (no touch points)', () => {
    expect(isIosSafari({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })).toBe(false);
  });

  it('false for Android Chrome', () => {
    expect(isIosSafari({ userAgent: ANDROID_CHROME, maxTouchPoints: 5 })).toBe(false);
  });
});
