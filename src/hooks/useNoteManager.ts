import { useCallback, useMemo } from "react";
import { Note, listNotes, saveNote, deleteNote } from "@/lib/noteStorage";
import { STORE_NAMES } from "@/lib/dbUtils";
import { onGarageChange } from "@/lib/garageEvents";
import { useAsyncSnapshot } from "./useAsyncSnapshot";

const EMPTY: Note[] = [];

// Notes are per-fileName — each session gets its own cache entry so switching
// files reads the correct list without a cross-tab refetch. A null fileName
// short-circuits to an empty snapshot with a no-op subscribe/load.
export function useNoteManager(fileName: string | null) {
  const load = useCallback(async () => {
    if (!fileName) return EMPTY;
    return listNotes(fileName);
  }, [fileName]);

  const subscribe = useMemo(
    () => (onChange: () => void) =>
      onGarageChange((c) => {
        if (c.store === STORE_NAMES.NOTES) onChange();
      }),
    [],
  );

  const { data: notes } = useAsyncSnapshot({
    key: `notes:${fileName ?? ""}`,
    initial: EMPTY,
    load,
    subscribe: fileName ? subscribe : undefined,
  });

  const addNote = useCallback(
    async (text: string) => {
      if (!fileName) return;
      const now = Date.now();
      const note: Note = {
        id: crypto.randomUUID(),
        fileName,
        text,
        createdAt: now,
        updatedAt: now,
      };
      await saveNote(note);
    },
    [fileName],
  );

  const updateNote = useCallback(
    async (id: string, text: string) => {
      const existing = notes.find((n) => n.id === id);
      if (!existing) return;
      await saveNote({ ...existing, text, updatedAt: Date.now() });
    },
    [notes],
  );

  const removeNote = useCallback(async (id: string) => {
    await deleteNote(id);
  }, []);

  return { notes, addNote, updateNote, removeNote };
}
