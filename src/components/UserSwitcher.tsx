import { useEffect, useRef, useState } from "react";
import { User, ChevronDown, Check, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalUsers } from "@/hooks/useLocalUsers";

interface UserSwitcherProps {
  /** Open the Users CRUD panel (in Settings). */
  onManage?: () => void;
}

/**
 * Compact active-user picker for the AppShell header. Shows the current user's
 * name; clicking opens a menu with every other user (switch on click), plus
 * an inline "Add profile" prompt and a "Manage profiles" link into Settings.
 * No auth — this is a shared-machine profile picker, not a login (plan 0011).
 *
 * Built on a plain useState popover instead of a Radix dropdown-menu (which
 * isn't in this fork's shadcn set) — same pattern as EngineCombobox.
 */
export function UserSwitcher({ onManage }: UserSwitcherProps) {
  const { users, activeUser, activeUserId, switchUser, createUser } = useLocalUsers();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName("");
        setError(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeName = activeUser?.name ?? "…";

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setError("Give the profile a name.");
      return;
    }
    if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      setError("A profile with that name already exists.");
      return;
    }
    const created = await createUser(name);
    if (!created) return;
    switchUser(created.id);
    setNewName("");
    setError(null);
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-sm text-foreground hover:bg-muted/50 transition-colors",
        )}
        title="Active profile"
      >
        <User className="w-4 h-4 opacity-70" />
        <span className="max-w-[10rem] truncate">{activeName}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-md">
          <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Profile</div>
          <div className="max-h-56 overflow-y-auto">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { switchUser(u.id); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/60 transition-colors"
              >
                <span className="flex-1 truncate">{u.name}</span>
                {u.id === activeUserId && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
          </div>
          <div className="border-t border-border">
            {creating ? (
              <div className="p-2 space-y-2" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleCreate(); } }}>
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setError(null); }}
                  placeholder="Nickname or first name"
                  className="h-8 text-sm"
                />
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-7" onClick={() => void handleCreate()}>Add</Button>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => { setCreating(false); setNewName(""); setError(null); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add profile</span>
              </button>
            )}
            {onManage && (
              <button
                type="button"
                onClick={() => { onManage(); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/60 transition-colors"
              >
                <Settings2 className="w-4 h-4" />
                <span>Manage profiles</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
