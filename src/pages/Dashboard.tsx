import { AppShell } from "@/components/AppShell";

/**
 * Dashboard — the app's home surface. Replaces the old LandingPage's welcome
 * flow: no hero, no "load sample" primary CTA. This is a stub for the shell
 * shape review; content (recent sessions, garage summary, tracks summary,
 * import panel, device panel) lands in follow-up commits.
 */
export default function Dashboard() {
  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dashboard shell — content lands in the next commits.
          </p>
        </div>

        {/* Placeholder tiles so the grid shape is visible. Each becomes a
            real card in a follow-up commit (recent sessions, garage, tracks,
            devices, import). */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["Recent sessions", "Garage", "Tracks", "Import", "Devices", "Tools"].map((label) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-card/50 p-4 min-h-32 flex items-center justify-center"
            >
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
