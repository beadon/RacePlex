import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { FileLoadingOverlay } from "@/components/FileLoadingOverlay";
import { CsvMappingDialog } from "@/components/CsvMappingDialog";
import { DebugConsole } from "@/components/DebugConsole";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { AuthProvider } from "@/contexts/AuthContext";
import { isNativeApp } from "@/lib/platform";
import { applyPalette } from "@/lib/palettes";
import { MigrationBanner } from "@/components/MigrationBanner";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const enableAdmin = import.meta.env.VITE_ENABLE_ADMIN === 'true';
const enableCloud = import.meta.env.VITE_ENABLE_CLOUD === 'true';

// Lazy-load secondary routes. Auth pages (Login/Register/Forgot/Reset/Callback)
// only mount when their gating flag is on, so a flag-off build never ships
// their chunks — preserving the offline-first invariant.
const Login = lazy(() => import("./pages/Login"));
const Admin = lazy(() => import("./pages/Admin"));
const Register = lazy(() => import("./pages/Register"));
const Leaderboards = lazy(() => import("./pages/Leaderboards"));
const DriverProfile = lazy(() => import("./pages/DriverProfile"));
// Multi-session comparison view (plan 0012 / issue #37). Its own route so a
// deep-link is possible in principle, though the page bounces back to the
// dashboard when it lands without a selection in router state.
const Compare = lazy(() => import("./pages/Compare"));
// Public, no-login account-deletion request page. Mounted un-gated (below) so the
// URL Google Play requires resolves on every build, even offline-only ones.
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const PendingCheckoutRedirect = lazy(() =>
  import("./components/PendingCheckoutRedirect").then((m) => ({ default: m.PendingCheckoutRedirect })),
);

const SETTINGS_KEY_BASE = "raceplex:settings";
const ACTIVE_USER_KEY = "raceplex:activeUserId";
const DEFAULT_USER_ID = "default-user";

/**
 * Same rule as `useSettings.settingsKey()` — kept as a private copy so this
 * boot-time palette read doesn't pull the hook module. The default user's
 * settings stay on the plain key so upgraders don't need a data move.
 */
function currentSettingsKey(): string {
  try {
    const uid = localStorage.getItem(ACTIVE_USER_KEY);
    if (!uid || uid === DEFAULT_USER_ID) return SETTINGS_KEY_BASE;
    return `${SETTINGS_KEY_BASE}:${uid}`;
  } catch {
    return SETTINGS_KEY_BASE;
  }
}

const App = () => {
  // Apply dark/light mode and the colour palette globally so Admin and all routes
  // respect the theme. index.html ships `data-palette="raceplex"` so first paint
  // is already branded; this only has to correct it for a user who picked another.
  useEffect(() => {
    const apply = () => {
      try {
        const stored = localStorage.getItem(currentSettingsKey());
        const parsed = stored ? JSON.parse(stored) : null;
        document.documentElement.classList.toggle('dark', !!parsed?.darkMode);
        applyPalette(parsed?.palette);
      } catch {
        /* malformed settings; fall through to the default light mode + palette */
        applyPalette(undefined);
      }
    };
    apply();
    window.addEventListener('storage', apply);
    return () => window.removeEventListener('storage', apply);
  }, []);

  return (
  <I18nextProvider i18n={i18n}>
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <FileLoadingOverlay />
        {/* Asks the rider to confirm the column mapping when an unrecognised GPS CSV is imported.
            Mounted app-wide (not in FileImport) so it also covers file-manager reopens and cloud
            opens — every path that goes through parseDatalogFile. */}
        <CsvMappingDialog />
        <DebugConsole />
        <BrowserRouter>
          {/* Old-domain-only migration notice (hackthetrack.net → lapwingdata.com).
              Renders nothing on the new site. Inside the router so it can navigate. */}
          <MigrationBanner />
          <Suspense fallback={null}>
            {enableCloud && !isNativeApp() && <PendingCheckoutRedirect />}
            <Routes>
              <Route path="/" element={<Index />} />
              {/* Multi-session comparison view (plan 0012 / issue #37).
                  Un-gated — comparison uses local files only, no backend. */}
              <Route path="/compare" element={<Compare />} />
              {/* Un-gated: Google Play requires a publicly reachable account-deletion
                  URL. The page itself adapts when cloud accounts are disabled. */}
              <Route path="/delete-account" element={<DeleteAccount />} />
              {(enableAdmin || enableCloud) && <Route path="/login" element={<Login />} />}
              {enableAdmin && <Route path="/admin" element={<Admin />} />}
              {enableCloud && <Route path="/register" element={<Register />} />}
              {enableCloud && <Route path="/leaderboards" element={<Leaderboards />} />}
              {enableCloud && <Route path="/driver/:username" element={<DriverProfile />} />}
              {enableCloud && <Route path="/forgot-password" element={<ForgotPassword />} />}
              {enableCloud && <Route path="/reset-password" element={<ResetPassword />} />}
              {enableCloud && <Route path="/auth/callback" element={<AuthCallback />} />}
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  </I18nextProvider>
  );
};

export default App;
