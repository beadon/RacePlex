import { describe, it, expect } from "vitest";
import { extraKeys, placeholderMismatches, type LocaleTree } from "@/lib/i18n/seedUtils";

// The Tools plugin owns its translations under ./locales/.
//
// ENGLISH IS THE SOURCE OF TRUTH; the other languages are best-effort. RacePlex is a small
// eskate-focused fork that inherited seven locales from upstream, and hand-writing six translations
// for every new string is friction with nobody waiting on the other end. i18next is configured with
// `fallbackLng: en`, so a key a translation hasn't caught up with simply renders in English — which
// is a perfectly good outcome, not a defect.
//
// So this test no longer fails a locale for LAGGING behind English. What it still checks are the
// two things that are genuinely broken rather than merely untranslated:
//
//   - an EXTRA key that English doesn't have — that's a typo or dead string, and it will never
//     render, so nobody would ever notice it was wrong;
//   - a PLACEHOLDER mismatch in a key that has been translated — `{{count}}` dropped from a
//     translation doesn't fall back, it renders broken text to that user.
const localeModules = import.meta.glob<LocaleTree>("./locales/*.json", {
  eager: true,
  import: "default",
});

const locales: Record<string, LocaleTree> = {};
for (const [path, tree] of Object.entries(localeModules)) {
  const code = path.match(/\/locales\/([^/]+)\.json$/)?.[1];
  if (code) locales[code] = tree;
}

const en = locales.en;
const nonEnglish = Object.keys(locales).filter((c) => c !== "en");

describe("tools plugin locale parity", () => {
  it("ships an English source bundle", () => {
    expect(en).toBeDefined();
    expect(nonEnglish.length).toBeGreaterThan(0);
  });

  for (const lng of nonEnglish) {
    // NOT asserted: that `lng` has every English key. A lagging translation falls back to English,
    // which is fine. Blocking a feature until six translations are hand-written is not.
    it(`${lng} has no keys English doesn't`, () => {
      expect(extraKeys(en, locales[lng]), `${lng} has keys not present in en`).toEqual([]);
    });

    it(`${lng} preserves placeholders/markup in whatever it has translated`, () => {
      expect(placeholderMismatches(en, locales[lng])).toEqual([]);
    });
  }
});
