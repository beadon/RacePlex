/**
 * The round trip: seed a browser, export it, wipe it, import the archive, and
 * assert the rider got everything back.
 *
 * This is the test that matters. `downloadMyData()` returning a valid-looking
 * ZIP proves nothing — an export you cannot restore is a museum piece, and the
 * failure mode is silent (the rider finds out on the new laptop, having already
 * cleared the old one). So this exercises real IndexedDB (fake-indexeddb), real
 * localStorage, and a real JSZip archive, end to end.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import JSZip from "jszip";
import { freshIndexedDB } from "./__test__/idb";
import { STORE_NAMES, withReadTransaction, withWriteTransaction } from "./dbUtils";
import { saveFile, listFiles, getFile } from "./fileStorage";
import { buildArchive, collectLocalData, estimateVideoBytes, exportFileName } from "./dataExport";
import { importArchive, classifyEntry } from "./dataImport";
import { getPluginStore } from "@/plugins/storage";

/** Minimal in-memory localStorage — the node environment has none. */
function installLocalStorage(): void {
  let map = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void (map = new Map()),
  } as unknown as Storage;
}

/** Seed the browser with a rider's data: sessions, garage, settings, tool state. */
async function seedBrowser(): Promise<void> {
  await saveFile("morning-run.csv", new Blob(["time,lat,lon\n0,45.1,-122.3\n"]));
  await saveFile("hill-bomb.gpx", new Blob(["<gpx></gpx>"]));

  await withWriteTransaction(STORE_NAMES.METADATA, (s) =>
    s.put({ fileName: "morning-run.csv", trackName: "Powell Butte", courseName: "Descent", fastestLapMs: 36480 }),
  );
  await withWriteTransaction(STORE_NAMES.KARTS, (s) =>
    s.put({ id: "board-1", name: "Kaly XL", vehicleTypeId: "eskate" }),
  );
  await withWriteTransaction(STORE_NAMES.NOTES, (s) =>
    s.put({ id: "n1", fileName: "morning-run.csv", text: "wheelbite on the last corner" }),
  );
  // A lap snapshot — one of the stores the ORIGINAL export silently dropped.
  await withWriteTransaction(STORE_NAMES.LAP_SNAPSHOTS, (s) =>
    s.put({ id: "snap-1", courseKey: "powell:descent", engineKey: "6374", lapTimeMs: 36480 }),
  );
  await withWriteTransaction(STORE_NAMES.VIDEO_SYNC, (s) =>
    s.put({ sessionFileName: "morning-run.csv", offsetMs: 4200 }),
  );

  localStorage.setItem("raceplex:settings", JSON.stringify({ useKph: false, darkMode: true }));
  localStorage.setItem("racing-datalog-tracks-v2", JSON.stringify([{ name: "Powell Butte" }]));
  // Remembered CSV column mappings — the other thing the original export dropped.
  localStorage.setItem("raceplex-csv-mappings-v1", JSON.stringify({ abc123: { lat: "Latitude" } }));
  // Transient state that must NOT travel to a new browser.
  localStorage.setItem("raceplex:legacy-migration-done", "true");
  localStorage.setItem("session:lastOpen", "morning-run.csv");

  await getPluginStore("tools").set("stance:v1", { footAngle: 42 });
}

beforeEach(async () => {
  freshIndexedDB();
  installLocalStorage();
  await seedBrowser();
});

describe("export → import round trip", () => {
  it("restores sessions, garage, settings and tool state into a wiped browser", async () => {
    const local = await collectLocalData();
    const archive = await buildArchive(local);

    // Wipe the browser: new origin, nothing carried over.
    freshIndexedDB();
    installLocalStorage();
    expect(await listFiles()).toHaveLength(0);

    const summary = await importArchive(archive);

    // Session logs came back, with their bytes intact.
    const files = await listFiles();
    expect(files.map((f) => f.name).sort()).toEqual(["hill-bomb.gpx", "morning-run.csv"]);
    expect(summary.files).toBe(2);
    expect(await (await getFile("morning-run.csv"))!.text()).toContain("45.1,-122.3");

    // Garage came back.
    const meta = await withReadTransaction<Record<string, unknown>[]>(STORE_NAMES.METADATA, (s) => s.getAll());
    expect(meta[0]).toMatchObject({ fileName: "morning-run.csv", trackName: "Powell Butte", fastestLapMs: 36480 });
    const vehicles = await withReadTransaction<Record<string, unknown>[]>(STORE_NAMES.KARTS, (s) => s.getAll());
    expect(vehicles[0]).toMatchObject({ id: "board-1", name: "Kaly XL" });
    const notes = await withReadTransaction<Record<string, unknown>[]>(STORE_NAMES.NOTES, (s) => s.getAll());
    expect(notes[0]).toMatchObject({ text: "wheelbite on the last corner" });

    // The stores the original export dropped.
    const snaps = await withReadTransaction<Record<string, unknown>[]>(STORE_NAMES.LAP_SNAPSHOTS, (s) => s.getAll());
    expect(snaps[0]).toMatchObject({ id: "snap-1", lapTimeMs: 36480 });
    const vsync = await withReadTransaction<Record<string, unknown>[]>(STORE_NAMES.VIDEO_SYNC, (s) => s.getAll());
    expect(vsync[0]).toMatchObject({ sessionFileName: "morning-run.csv", offsetMs: 4200 });

    // Settings, tracks, and the remembered CSV mapping.
    expect(JSON.parse(localStorage.getItem("raceplex:settings")!)).toEqual({ useKph: false, darkMode: true });
    expect(JSON.parse(localStorage.getItem("racing-datalog-tracks-v2")!)).toEqual([{ name: "Powell Butte" }]);
    expect(JSON.parse(localStorage.getItem("raceplex-csv-mappings-v1")!)).toEqual({ abc123: { lat: "Latitude" } });
    expect(summary.settings).toBeGreaterThan(0);

    // Tool state.
    expect(await getPluginStore("tools").get("stance:v1")).toEqual({ footAngle: 42 });
  });

  it("does not carry one-shot migration flags or transient UI state to the new browser", async () => {
    const archive = await buildArchive(await collectLocalData());
    freshIndexedDB();
    installLocalStorage();
    await importArchive(archive);

    // Restoring "migration already done" onto a fresh origin would skip a
    // migration that origin still needs — a silent data loss on restore.
    expect(localStorage.getItem("raceplex:legacy-migration-done")).toBeNull();
    expect(localStorage.getItem("session:lastOpen")).toBeNull();
  });

  it("never overwrites a session that is already on this device", async () => {
    const archive = await buildArchive(await collectLocalData());

    // Same browser, but morning-run.csv has since been re-recorded with new data.
    freshIndexedDB();
    installLocalStorage();
    await saveFile("morning-run.csv", new Blob(["NEWER DATA"]));

    const summary = await importArchive(archive);

    expect(await (await getFile("morning-run.csv"))!.text()).toBe("NEWER DATA");
    expect(summary.filesSkipped).toBe(1);
    expect(summary.files).toBe(1); // only hill-bomb.gpx was new
  });

  it("upserts garage rows, so re-importing over existing data converges", async () => {
    const archive = await buildArchive(await collectLocalData());
    // Import twice into the same browser: the second must not duplicate rows.
    freshIndexedDB();
    installLocalStorage();
    await importArchive(archive);
    await importArchive(archive);

    const vehicles = await withReadTransaction<unknown[]>(STORE_NAMES.KARTS, (s) => s.getAll());
    expect(vehicles).toHaveLength(1);
  });
});

describe("videos are opt-in", () => {
  async function seedVideo(): Promise<void> {
    await withWriteTransaction(STORE_NAMES.SESSION_VIDEOS, (s) =>
      s.put({
        sessionFileName: "morning-run.csv",
        data: new Blob(["x".repeat(2048)]),
        size: 2048,
        savedAt: Date.now(),
      }),
    );
  }

  it("leaves videos out by default — a season of footage is gigabytes", async () => {
    await seedVideo();
    const local = await collectLocalData();
    expect(local.videoNames).toEqual([]);

    const zip = await JSZip.loadAsync(await buildArchive(local));
    expect(Object.keys(zip.files).some((p) => p.startsWith("local/videos/"))).toBe(false);
  });

  it("includes them, and restores them, when the rider asks", async () => {
    await seedVideo();
    const local = await collectLocalData(true);
    expect(local.videoNames).toEqual(["morning-run.csv"]);

    const archive = await buildArchive(local);
    freshIndexedDB();
    installLocalStorage();
    const summary = await importArchive(archive);

    expect(summary.videos).toBe(1);
    const rows = await withReadTransaction<{ data: Blob }[]>(STORE_NAMES.SESSION_VIDEOS, (s) => s.getAll());
    expect(rows[0].data.size).toBe(2048);
  });

  it("measures the video bytes so the UI can warn before the rider waits on them", async () => {
    await seedVideo();
    expect(await estimateVideoBytes()).toEqual({ count: 1, bytes: 2048 });
  });
});

describe("importArchive is a trust boundary", () => {
  it("ignores an archive entry that names a store outside the inventory", async () => {
    // A ZIP is user-supplied input; its paths are attacker-controlled. The
    // importer must iterate the inventory, not the archive's paths.
    const zip = new JSZip();
    zip.file("local/stores/users.json", JSON.stringify([{ id: "u1", name: "ok" }]));
    zip.file("local/stores/../../evil.json", JSON.stringify([{ id: "x" }]));
    zip.file("local/localStorage.json", JSON.stringify({ "attacker-key": "pwned", "raceplex:settings": "{}" }));
    const blob = await zip.generateAsync({ type: "blob" });

    freshIndexedDB();
    installLocalStorage();
    await importArchive(blob);

    // The allowlisted key was written; the arbitrary one was not.
    expect(localStorage.getItem("raceplex:settings")).toBe("{}");
    expect(localStorage.getItem("attacker-key")).toBeNull();
  });

  it("survives a corrupt store file without abandoning the rest of the restore", async () => {
    const zip = await JSZip.loadAsync(await buildArchive(await collectLocalData()));
    zip.file("local/stores/karts.json", "{ not json");
    const blob = await zip.generateAsync({ type: "blob" });

    freshIndexedDB();
    installLocalStorage();
    const summary = await importArchive(blob);

    // Vehicles are lost (their file was corrupt), but the sessions still land.
    expect(summary.files).toBe(2);
    const notes = await withReadTransaction<unknown[]>(STORE_NAMES.NOTES, (s) => s.getAll());
    expect(notes).toHaveLength(1);
  });
});

describe("classifyEntry", () => {
  it("maps each archive path to what it is", () => {
    expect(classifyEntry("local/stores/karts.json")).toEqual({ kind: "store", store: "karts" });
    expect(classifyEntry("local/files/a.csv")).toEqual({ kind: "file", name: "a.csv" });
    expect(classifyEntry("local/videos/a.csv")).toEqual({ kind: "video", name: "a.csv" });
    expect(classifyEntry("local/localStorage.json")).toEqual({ kind: "localStorage" });
    expect(classifyEntry("local/plugins/tools.json")).toEqual({ kind: "plugin", pluginId: "tools" });
  });

  it("restores a cloud-era archive into a local-only build", () => {
    // Archives exported when the user had an account carry cloud/files/. A
    // RacePlex build has no backend, so those must still restore locally.
    expect(classifyEntry("cloud/files/synced.csv")).toEqual({ kind: "file", name: "synced.csv" });
  });

  it("ignores anything it doesn't recognise", () => {
    expect(classifyEntry("README.txt")).toBeNull();
    expect(classifyEntry("cloud/profile.json")).toBeNull();
    expect(classifyEntry("../../etc/passwd")).toBeNull();
  });
});

describe("exportFileName", () => {
  it("dates the archive so successive exports don't collide", () => {
    expect(exportFileName(new Date("2026-07-13T10:00:00Z"))).toBe("raceplex-data-2026-07-13.zip");
  });
});
