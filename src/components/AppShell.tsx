import { type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Gauge, Car, Map as MapIcon, Wrench, Settings as SettingsIcon } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { cn } from "@/lib/utils";

/**
 * App-wide chrome: a responsive nav (top bar on md+, bottom bar on mobile)
 * wrapping every top-level route. Sits ABOVE per-page headers (so a session
 * view can still have its own toolbar; the shell just adds the outer nav).
 *
 * Nav destinations are the app's top-level surfaces, not per-session tabs:
 * - Sessions (the dashboard / current session)
 * - Garage (vehicles, setups)
 * - Tracks (track collection)
 * - Tools (phone lap timer, seat position, etc.)
 * - Settings
 *
 * Auth / cloud / device menus stay in the desktop top bar's right cluster.
 * The mobile bottom bar is icon-only to preserve vertical space.
 */

interface AppShellProps {
  /** Right-hand controls for the desktop top bar (settings, profile, sign-in). */
  rightSlot?: ReactNode;
  children: ReactNode;
}

interface NavDest {
  to: string;
  label: string;
  icon: ReactNode;
}

const DESTINATIONS: NavDest[] = [
  { to: "/", label: "Sessions", icon: <Gauge className="w-5 h-5" /> },
  { to: "/garage", label: "Garage", icon: <Car className="w-5 h-5" /> },
  { to: "/tracks", label: "Tracks", icon: <MapIcon className="w-5 h-5" /> },
  { to: "/tools", label: "Tools", icon: <Wrench className="w-5 h-5" /> },
  { to: "/settings", label: "Settings", icon: <SettingsIcon className="w-5 h-5" /> },
];

export function AppShell({ rightSlot, children }: AppShellProps) {

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
              {DESTINATIONS.map((d) => (
                <NavLink
                  key={d.to}
                  to={d.to}
                  end={d.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )
                  }
                >
                  {d.icon}
                  <span>{d.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">{rightSlot}</div>
        </div>
      </header>

      {/* Mobile top strip: brand + right cluster only. Nav is at the bottom. */}
      <header className="md:hidden sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm safe-area-top">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <NavLink to="/" className="flex items-center gap-2">
            <BrandLogo className="w-6 h-6" />
            <span className="text-base font-semibold text-foreground">RacePlex</span>
          </NavLink>
          <div className="flex items-center gap-1">{rightSlot}</div>
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
        {DESTINATIONS.map((d) => (
          <NavLink
            key={d.to}
            to={d.to}
            end={d.to === "/"}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {d.icon}
            <span className="text-[10px] leading-tight">{d.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
