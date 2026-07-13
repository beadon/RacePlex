import { useState, useEffect, useCallback } from "react";
import { User as UserIcon, Pencil, Trash2, Plus, Check, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalUsers } from "@/hooks/useLocalUsers";
import { STORE_NAMES } from "@/lib/dbUtils";
import { countUserRows, type UserRowCounts } from "@/lib/localUserStorage";

/**
 * Human-friendly label for each user-scoped store in the delete-confirm
 * preview. Any store not listed here still gets shown by its raw name if it
 * has rows — kept generous so a rider can spot anything unexpected.
 */
const STORE_LABELS: Record<string, string> = {
  [STORE_NAMES.FILES]: "sessions",
  [STORE_NAMES.METADATA]: "session tags",
  [STORE_NAMES.KARTS]: "vehicles",
  [STORE_NAMES.ENGINES]: "engines",
  [STORE_NAMES.NOTES]: "notes",
  [STORE_NAMES.SETUPS]: "setups",
  [STORE_NAMES.SETUP_REVISIONS]: "setup revisions",
  [STORE_NAMES.LAP_SNAPSHOTS]: "lap snapshots",
  [STORE_NAMES.GRAPH_PREFS]: "graph preferences",
  [STORE_NAMES.VIDEO_SYNC]: "video sync markers",
  [STORE_NAMES.SESSION_VIDEOS]: "session videos",
  [STORE_NAMES.VEHICLE_TYPES]: "vehicle types",
  [STORE_NAMES.SETUP_TEMPLATES]: "setup templates",
  [STORE_NAMES.WEATHER_CACHE]: "weather-cache entries",
};

function summariseCounts(counts: UserRowCounts | null): Array<{ label: string; n: number }> {
  if (!counts) return [];
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([store, n]) => ({ label: STORE_LABELS[store] ?? store, n }));
}

/**
 * Full CRUD for local profiles. Lives inside Settings so the header switcher
 * doesn't turn into a giant popover; the switcher's "Manage profiles" link
 * opens Settings and this section is right at the top.
 */
export function UsersManagerPanel() {
  const { users, activeUserId, defaultUserId, switchUser, createUser, renameUser, removeUser } = useLocalUsers();

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Cache of previously-fetched counts, keyed by user id. Reading `null` here
  // means "not counted yet"; the effect below fetches on first-open and stores
  // the result under the same key. Deriving `confirmCounts` from this + the
  // active confirm id keeps state assignments out of the effect body (React
  // Compiler flags `useEffect` → `setState` mirrors).
  const [countsByUser, setCountsByUser] = useState<Record<string, UserRowCounts>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDeleteId) return;
    if (countsByUser[confirmDeleteId]) return; // already have counts
    let cancelled = false;
    void countUserRows(confirmDeleteId).then((c) => {
      if (cancelled) return;
      setCountsByUser((prev) => ({ ...prev, [confirmDeleteId]: c }));
    });
    return () => { cancelled = true; };
  }, [confirmDeleteId, countsByUser]);

  const confirmCounts = confirmDeleteId ? countsByUser[confirmDeleteId] ?? null : null;

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) { setCreateError("Give the profile a name."); return; }
    if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      setCreateError("A profile with that name already exists."); return;
    }
    const created = await createUser(name);
    if (!created) return;
    setNewName(""); setCreateError(null); setCreating(false);
  }, [newName, users, createUser]);

  const handleStartEdit = (id: string, name: string) => { setEditingId(id); setEditName(name); };
  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    await renameUser(editingId, name);
    setEditingId(null); setEditName("");
  }, [editingId, editName, renameUser]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    try {
      await removeUser(confirmDeleteId);
      setConfirmDeleteId(null);
      setConfirmError(null);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : String(e));
    }
  }, [confirmDeleteId, removeUser]);

  const deleteTargets = summariseCounts(confirmCounts);

  return (
    <div>
      <h3 className="font-medium flex items-center gap-2">
        <UserIcon className="w-4 h-4 opacity-70" />
        Profiles
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Local, offline profiles for shared machines. Each profile keeps its own
        sessions, garage, notes, and settings. No accounts, no cloud.
      </p>

      <div className="mt-3 space-y-1">
        {users.map((u) => {
          const isActive = u.id === activeUserId;
          const isEditing = editingId === u.id;
          const isDefault = u.id === defaultUserId;
          if (isEditing) {
            return (
              <div key={u.id} className="flex items-center gap-2 p-2 rounded-md border border-primary/40 bg-primary/5">
                <Input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSaveEdit(); if (e.key === "Escape") setEditingId(null); }}
                  className="h-7 flex-1 text-sm"
                />
                <Button size="icon" className="h-7 w-7" onClick={() => void handleSaveEdit()} title="Save">
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)} title="Cancel">
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            );
          }
          return (
            <div
              key={u.id}
              className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors ${isActive ? "ring-1 ring-primary bg-primary/5" : ""}`}
            >
              <button
                type="button"
                onClick={() => switchUser(u.id)}
                className="flex-1 min-w-0 text-left"
                title={isActive ? "Active profile" : "Switch to this profile"}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate text-foreground">{u.name}</span>
                  {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">Active</span>}
                  {isDefault && <span className="text-[10px] text-muted-foreground">Default</span>}
                </div>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-60 hover:opacity-100"
                onClick={() => handleStartEdit(u.id, u.name)}
                title="Rename"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-60 hover:opacity-100 hover:text-destructive disabled:opacity-25 disabled:hover:text-current"
                onClick={() => setConfirmDeleteId(u.id)}
                disabled={isDefault}
                title={isDefault ? "The default profile can't be deleted (rename it instead)" : "Delete"}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      {creating ? (
        <div
          className="mt-3 p-2 rounded-md border border-border/60 space-y-2"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleCreate(); } }}
        >
          <Input
            autoFocus
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setCreateError(null); }}
            placeholder="Nickname or first name"
            className="h-8 text-sm"
          />
          {createError && <p className="text-xs text-destructive">{createError}</p>}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-8" onClick={() => void handleCreate()}>Add profile</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setCreating(false); setNewName(""); setCreateError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-3 h-8 gap-1.5" onClick={() => setCreating(true)}>
          <Plus className="w-3.5 h-3.5" /> Add profile
        </Button>
      )}

      {confirmDeleteId && (
        <div className="mt-3 p-3 rounded-md border border-destructive/40 bg-destructive/5 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-foreground">
                Delete {users.find((u) => u.id === confirmDeleteId)?.name}?
              </p>
              {confirmCounts === null ? (
                <p className="mt-1 text-xs text-muted-foreground">Checking what would be erased…</p>
              ) : deleteTargets.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">This profile has no data yet — the delete is instant.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">Deletes:</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-foreground">
                    {deleteTargets.map((t) => (
                      <li key={t.label} className="tabular-nums">
                        <span className="font-semibold">{t.n}</span> {t.label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {confirmError && <p className="mt-2 text-xs text-destructive">{confirmError}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => { setConfirmDeleteId(null); setConfirmError(null); }}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => void handleConfirmDelete()}>Delete profile</Button>
          </div>
        </div>
      )}
    </div>
  );
}
