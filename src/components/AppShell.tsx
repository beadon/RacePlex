import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Gauge, Car, Map as MapIcon, Wrench, Settings as SettingsIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { UserSwitcher } from "@/components/UserSwitcher";
import { cn } from "@/lib/utils";

/**
 * App-wide chrome: a responsive nav (top bar on md+, bottom bar on mobile)
 * wrapping every top-level route. Sits ABOVE per-page headers (so a session
 * view can still have its own toolbar; the shell just adds the outer nav).
 *
 * Nav destinations are the app's top-level surfaces, not per-session tabs:
 * - Sessions (the dashboard / current session, route: `/`)
 * - Garage (vehicles, setups — opens the file-manager drawer)
 * - Tracks (track collection — opens the TrackEditor dialog)
 * - Tools (phone lap timer, seat position — routes to Tools plugin)
 * - Settings (app settings modal)
 *
 * Garage / Tracks / Settings live in existing drawers + dialogs, not
 * standalone pages — so their nav entries fire callbacks instead of
 * routing. Callers pass those handlers via the `actions` prop. When an
 * action isn't provided the destination is hidden (so a page that shouldn't
 * offer, say, garage access doesn't advertise it).
 *
 * Tools stays a real route once the Tools page lands; today it can be an
 * action too if the caller wants to route to something else in the interim.
 */

export interface AppShellActions {
  onOpenGarage?: () => void;
  onOpenTracks?: () => void;
  onOpenSettings?: () => void;
  onOpenTools?: () => void;
}

interface AppShellProps {
  /** Right-hand controls for the desktop top bar (settings, profile, sign-in). */
  rightSlot?: ReactNode;
  /** Action handlers for the nav destinations that don't have their own
   *  route. Omitted actions hide their nav entry. */
  actions?: AppShellActions;
  children: ReactNode;
}

interface NavItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Either a route (renders as a NavLink) OR an action (renders as a button). */
  to?: string;
  onClick?: () => void;
}

export function AppShell({ rightSlot, actions, children }: AppShellProps) {
  const items: NavItem[] = [
    { key: "sessions", label: "Sessions", icon: <Gauge className="w-5 h-5" />, to: "/" },
  ];
  if (actions?.onOpenGarage) {
    items.push({ key: "garage", label: "Garage", icon: <Car className="w-5 h-5" />, onClick: actions.onOpenGarage });
  }
  if (actions?.onOpenTracks) {
    items.push({ key: "tracks", label: "Tracks", icon: <MapIcon className="w-5 h-5" />, onClick: actions.onOpenTracks });
  }
  if (actions?.onOpenTools) {
    items.push({ key: "tools", label: "Tools", icon: <Wrench className="w-5 h-5" />, onClick: actions.onOpenTools });
  }
  if (actions?.onOpenSettings) {
    items.push({ key: "settings", label: "Settings", icon: <SettingsIcon className="w-5 h-5" />, onClick: actions.onOpenSettings });
  }

  const desktopItemClass = (isActive: boolean) =>
    cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
      isActive
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
    );

  const mobileItemClass = (isActive: boolean) =>
    cn(
      "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors",
      isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="min-h-screen bg-background flex flex-col safe-area-x">
      {/* Desktop top bar (md+). Brand + horizontal nav + right-side cluster. */}
      <header className="hidden md:block sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm safe-area-top">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2">
              <BrandLogo className="w-7 h-7" />
              <span className="text-lg font-semibold text-foreground">RacePlex</span>
            </NavLink>
            <nav className="flex items-center gap-1">
              {items.map((it) =>
                it.to ? (
                  <NavLink
                    key={it.key}
                    to={it.to}
                    end={it.to === "/"}
                    className={({ isActive }) => desktopItemClass(isActive)}
                  >
                    {it.icon}
                    <span>{it.label}</span>
                  </NavLink>
                ) : (
                  <button
                    key={it.key}
                    type="button"
                    onClick={it.onClick}
                    className={desktopItemClass(false)}
                  >
                    {it.icon}
                    <span>{it.label}</span>
                  </button>
                ),
              )}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <UserSwitcher onManage={actions?.onOpenSettings} />
            {rightSlot}
          </div>
        </div>
      </header>

      {/* Mobile top strip: brand + right cluster only. Nav is at the bottom. */}
      <header className="md:hidden sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm safe-area-top">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <NavLink to="/" className="flex items-center gap-2">
            <BrandLogo className="w-6 h-6" />
            <span className="text-base font-semibold text-foreground">RacePlex</span>
          </NavLink>
          <div className="flex items-center gap-1">
            <UserSwitcher onManage={actions?.onOpenSettings} />
            {rightSlot}
          </div>
        </div>
      </header>

      {/* Main content region. Bottom padding on mobile leaves room for the
          bottom nav; on desktop no extra padding is needed. */}
      <main className="flex-1 pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom nav (below md). Icon+label per destination. */}
      <nav
        className={cn(
          "md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur-sm safe-area-bottom",
          "flex items-stretch justify-around",
        )}
      >
        {items.map((it) =>
          it.to ? (
            <NavLink
              key={it.key}
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) => mobileItemClass(isActive)}
            >
              {it.icon}
              <span className="text-[10px] leading-tight">{it.label}</span>
            </NavLink>
          ) : (
            <button
              key={it.key}
              type="button"
              onClick={it.onClick}
              className={mobileItemClass(false)}
            >
              {it.icon}
              <span className="text-[10px] leading-tight">{it.label}</span>
            </button>
          ),
        )}
      </nav>
    </div>
  );
}
