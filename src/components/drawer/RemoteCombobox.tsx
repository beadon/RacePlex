import { useEffect, useMemo, useRef, useState } from "react";
import { Radio, Settings, X, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Remote, RemoteRadio } from "@/lib/remoteStorage";

interface RemoteComboboxProps {
  /** Currently-paired remote id, or null when none is paired. */
  value: string | null;
  onChange: (id: string | null) => void;
  remotes: Remote[];
  onCreate: (input: Omit<Remote, "id" | "createdAt">) => Promise<Remote>;
  onUpdate: (id: string, patch: Partial<Omit<Remote, "id" | "createdAt">>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function remoteLabel(r: Remote): string {
  return `${r.brand} · ${r.model}`;
}

/**
 * Reusable-remote picker for the vehicle form (plan 0010): dropdown to pair a
 * remote, `Manage` opens a dialog to add/edit/delete catalog entries. The
 * catalog is per-user and seeded once on first read (see remoteStorage).
 */
export function RemoteCombobox({ value, onChange, remotes, onCreate, onUpdate, onDelete }: RemoteComboboxProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const paired = useMemo(() => remotes.find((r) => r.id === value) ?? null, [remotes, value]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Remote</Label>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setManageOpen(true)}
        >
          Manage
        </button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={value ?? "unset"} onValueChange={(v) => onChange(v === "unset" ? null : v)}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Pick a remote" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="unset">Not paired</SelectItem>
            {remotes.map((r) => (
              <SelectItem key={r.id} value={r.id}>{remoteLabel(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {paired && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {[paired.radio === "other" ? paired.radioOther : paired.radio,
            paired.rangeMeters ? `${paired.rangeMeters} m range` : null,
            paired.batteryLifeHours ? `${paired.batteryLifeHours} h battery` : null,
          ].filter(Boolean).join(" · ")}
        </div>
      )}

      <ManageRemotesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        remotes={remotes}
        pairedId={value}
        onCreate={onCreate}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </div>
  );
}

interface ManageProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  remotes: Remote[];
  pairedId: string | null;
  onCreate: RemoteComboboxProps["onCreate"];
  onUpdate: RemoteComboboxProps["onUpdate"];
  onDelete: RemoteComboboxProps["onDelete"];
}

function ManageRemotesDialog({ open, onOpenChange, remotes, pairedId, onCreate, onUpdate, onDelete }: ManageProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const handleOpenChange = (v: boolean) => {
    if (!v) { setEditingId(null); setCreating(false); }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="w-4 h-4" /> Manage remotes
          </DialogTitle>
          <DialogDescription>
            Every board can carry a paired remote. Add the ones you own.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {remotes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No remotes yet.</p>
          ) : (
            remotes.map((r) =>
              editingId === r.id ? (
                <RemoteEditor
                  key={r.id}
                  initial={r}
                  onCancel={() => setEditingId(null)}
                  onSave={async (patch) => { await onUpdate(r.id, patch); setEditingId(null); }}
                />
              ) : (
                <div
                  key={r.id}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Radio className="w-3.5 h-3.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate text-foreground">{remoteLabel(r)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[r.radio === "other" ? r.radioOther : r.radio,
                        r.rangeMeters ? `${r.rangeMeters} m` : null,
                        r.batteryLifeHours ? `${r.batteryLifeHours} h` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                    onClick={() => setEditingId(r.id)}
                    title="Edit"
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 hover:text-destructive disabled:opacity-25 disabled:hover:text-current"
                    disabled={r.id === pairedId}
                    title={r.id === pairedId ? "Unpair first to delete" : "Delete"}
                    onClick={() => void onDelete(r.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ),
            )
          )}
        </div>

        {creating ? (
          <RemoteEditor
            initial={null}
            onCancel={() => setCreating(false)}
            onSave={async (input) => { await onCreate(input as Omit<Remote, "id" | "createdAt">); setCreating(false); }}
          />
        ) : (
          <Button size="sm" variant="outline" className="w-full h-8 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" /> Add remote
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface EditorProps {
  initial: Remote | null;
  onSave: (patch: Partial<Omit<Remote, "id" | "createdAt">>) => Promise<void>;
  onCancel: () => void;
}

function RemoteEditor({ initial, onSave, onCancel }: EditorProps) {
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [radio, setRadio] = useState<RemoteRadio | undefined>(initial?.radio);
  const [radioOther, setRadioOther] = useState(initial?.radioOther ?? "");
  const [rangeMeters, setRangeMeters] = useState<string>(initial?.rangeMeters?.toString() ?? "");
  const [batteryLifeHours, setBatteryLifeHours] = useState<string>(initial?.batteryLifeHours?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const brandRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    brandRef.current?.focus();
  }, []);

  const canSave = brand.trim() && model.trim();

  const save = async () => {
    if (!canSave) return;
    await onSave({
      brand: brand.trim(),
      model: model.trim(),
      radio,
      radioOther: radio === "other" ? radioOther.trim() || undefined : undefined,
      rangeMeters: rangeMeters === "" ? undefined : Number(rangeMeters),
      batteryLifeHours: batteryLifeHours === "" ? undefined : Number(batteryLifeHours),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px]">Brand</Label>
          <Input ref={brandRef} value={brand} onChange={(e) => setBrand(e.target.value)} className="h-7 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Model</Label>
          <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-7 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Radio</Label>
          <Select value={radio ?? "unset"} onValueChange={(v) => setRadio(v === "unset" ? undefined : (v as RemoteRadio))}>
            <SelectTrigger className="h-7 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Not set</SelectItem>
              <SelectItem value="2.4 GHz">2.4 GHz</SelectItem>
              <SelectItem value="sub-GHz">sub-GHz (900 MHz, 433 MHz)</SelectItem>
              <SelectItem value="BLE">Bluetooth LE</SelectItem>
              <SelectItem value="other">Other…</SelectItem>
            </SelectContent>
          </Select>
          {radio === "other" && (
            <Input value={radioOther} onChange={(e) => setRadioOther(e.target.value)} placeholder="Describe radio" className="h-7 text-sm mt-1" />
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Range (m)</Label>
          <Input type="number" value={rangeMeters} onChange={(e) => setRangeMeters(e.target.value)} className="h-7 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px]">Battery life (h)</Label>
          <Input type="number" value={batteryLifeHours} onChange={(e) => setBatteryLifeHours(e.target.value)} className="h-7 text-sm" />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-[11px]">Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-7 text-sm" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={onCancel}>
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
        <Button size="sm" className="h-7" onClick={() => void save()} disabled={!canSave}>
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  );
}
