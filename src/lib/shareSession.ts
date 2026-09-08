/**
 * Share a just-recorded session file to another person — a chat app, email,
 * or a text message — instead of only ever downloading it to the same
 * device. Uses the Web Share API's file support (the OS share sheet:
 * WhatsApp, Telegram, Mail, Messages, …) when the browser has it, and falls
 * back to a plain download otherwise (`useFileManager.ts`'s `exportFile`
 * pattern) so the rider can still get the file out even on a browser
 * without file-sharing support.
 */

const RACEPLEX_URL = "https://beadon.github.io/RacePlex/";

function buildShareText(): string {
  return `Here's my RacePlex session — open ${RACEPLEX_URL} and use Import to load it and see the map, chart, and lap times.`;
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Open the OS share sheet with the session file attached and a message
 * pointing the recipient at RacePlex to open it, falling back to a plain
 * download when the browser can't share files (most desktop browsers).
 */
export async function shareOrDownloadSession(fileName: string, blob: Blob): Promise<void> {
  const file = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
  const shareData: ShareData = { files: [file], title: "RacePlex session", text: buildShareText() };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      return;
    } catch (e) {
      // The rider closing the share sheet isn't a failure — just stop.
      if (e instanceof Error && e.name === "AbortError") return;
      // Any other failure (no matching app, browser quirk) falls through to download.
    }
  }

  downloadBlob(fileName, blob);
}
