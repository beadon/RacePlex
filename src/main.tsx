import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { toast } from "@/components/ui/sonner";
import { registerSW } from "virtual:pwa-register";

createRoot(document.getElementById("root")!).render(<App />);

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const isPreviewHost =
  window.location.hostname.includes("id-preview--") ||
  window.location.hostname.includes("lovableproject.com") ||
  window.location.hostname.includes("lovable.app");

if (isInIframe || isPreviewHost) {
  navigator.serviceWorker?.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
} else {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast("Update ready", {
        description: "Refresh to clear stale cached files and load the latest app version.",
        duration: Infinity,
        action: {
          label: "Refresh",
          onClick: async () => {
            await updateSW(true);
          },
        },
        cancel: {
          label: "Later",
          onClick: () => undefined,
        },
      });
    },
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (!registration) return;

      window.setInterval(() => {
        void registration.update();
      }, 60_000);
    },
  });
}
