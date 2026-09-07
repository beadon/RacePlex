/**
 * Best-effort device model name for the "This device" tile (issue #54) — a
 * rider trying the phone-GPS recorder before buying a logger wants to see
 * it's *their* phone, not a generic label.
 *
 * User-Agent Client Hints' `model` high-entropy hint is Chromium/Android
 * only — desktop Chrome and iOS/Android Safari and Firefox all lack
 * `navigator.userAgentData` entirely. There's no reliable way to get a real
 * model name on those, so they fall back to `null` rather than a guess.
 */
interface UserAgentDataWithHighEntropy {
  getHighEntropyValues(hints: string[]): Promise<{ model?: string }>;
}

export async function detectDeviceModel(
  nav: Navigator = navigator,
): Promise<string | null> {
  const uaData = (nav as Navigator & { userAgentData?: UserAgentDataWithHighEntropy }).userAgentData;
  if (!uaData) return null;
  try {
    const { model } = await uaData.getHighEntropyValues(["model"]);
    return model?.trim() || null;
  } catch {
    return null;
  }
}
