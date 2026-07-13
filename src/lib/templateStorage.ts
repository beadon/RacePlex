/**
 * IndexedDB CRUD for "vehicle-types" and "setup-templates" object stores.
 * Also handles seeding the built-in templates (eSkateboard, Kart) on first load.
 *
 * User-scoping (plan 0011): user-created types + templates are stamped with the
 * active user's id on save; the `list*` readers return the active user's rows
 * PLUS every row without a `userId`, so built-ins (seeded by `ensureDefaults`
 * without an owner) stay shared across every user. By-id readers and deletes
 * are intentionally not scoped — an id already narrows to a row, and existing
 * setups referencing a template must resolve regardless of who created it.
 */

import { openDB, STORE_NAMES } from './dbUtils';
import { emitGarageChange } from './garageEvents';
import { activeUserIdOrDefault } from './localUserStorage';

// ── Types ──

export interface TemplateFieldDef {
  id: string;
  name: string;
  type: "number" | "string";
  unit?: string;        // "mm", "in", "psi", "teeth", "degrees", etc.
  min?: number;
  max?: number;
  step?: number;
}

export interface TemplateSection {
  id: string;
  name: string;
  fields: TemplateFieldDef[];
}

export interface SetupTemplate {
  id: string;
  vehicleTypeId: string;
  name: string;
  sections: TemplateSection[];
  wheelCount: 2 | 4;
  includeTires: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Owning local user (plan 0011). Stamped by saveTemplate /
   * createVehicleTypeWithTemplate when missing; undefined for built-ins so they
   * are visible to every user. listTemplates returns "active user's rows OR no
   * userId" — by-id lookups (getTemplate) are unscoped.
   */
  userId?: string;
}

export interface VehicleType {
  id: string;
  name: string;
  templateId: string;
  wheelCount: 2 | 4;
  isDefault: boolean;
  createdAt: number;
  /** Last local edit time (ms) — set by saveVehicleType; used for sync merge. */
  updatedAt?: number;
  /**
   * Owning local user (plan 0011). Stamped by saveVehicleType /
   * createVehicleTypeWithTemplate when missing; undefined for built-ins so they
   * are visible to every user. listVehicleTypes returns "active user's rows OR
   * no userId" — by-id lookups (getVehicleType) are unscoped.
   */
  userId?: string;
}

// ── Built-in templates ──
//
// `isDefault` on these records means "built-in" — the vehicle-type editor uses
// it to block deletion, and nothing else reads it. Which type a *new vehicle*
// starts on is a separate question, answered by `defaultVehicleTypeId()` below.

export const DEFAULT_KART_VEHICLE_TYPE_ID = "default-kart-type";
export const DEFAULT_KART_TEMPLATE_ID = "default-kart-template";
export const DEFAULT_ESKATE_VEHICLE_TYPE_ID = "default-eskate-type";
export const DEFAULT_ESKATE_TEMPLATE_ID = "default-eskate-template";

const makeId = () => crypto.randomUUID();

export const DEFAULT_KART_TEMPLATE: SetupTemplate = {
  id: DEFAULT_KART_TEMPLATE_ID,
  vehicleTypeId: DEFAULT_KART_VEHICLE_TYPE_ID,
  name: "Kart",
  sections: [
    {
      id: "sec-alignment",
      name: "Alignment",
      fields: [
        { id: "f-toe", name: "Toe", type: "number" },
        { id: "f-camber", name: "Camber", type: "number" },
        { id: "f-castor", name: "Castor", type: "number" },
      ],
    },
    {
      id: "sec-dimensions",
      name: "Dimensions",
      fields: [
        { id: "f-front-width", name: "Front Width", type: "number", unit: "mm" },
        { id: "f-rear-width", name: "Rear Width", type: "number", unit: "mm" },
        { id: "f-rear-height", name: "Rear Height", type: "number", unit: "mm" },
      ],
    },
    {
      id: "sec-sprockets",
      name: "Sprockets",
      fields: [
        { id: "f-front-sprocket", name: "Front Sprocket", type: "number" },
        { id: "f-rear-sprocket", name: "Rear Sprocket", type: "number" },
      ],
    },
    {
      id: "sec-steering",
      name: "Steering",
      fields: [
        { id: "f-steering-brand", name: "Column Brand", type: "string" },
        { id: "f-steering-setting", name: "Steering", type: "number", min: 1, max: 5 },
        { id: "f-spindle-setting", name: "Spindle", type: "number", min: 1, max: 5 },
      ],
    },
  ],
  wheelCount: 4,
  includeTires: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

export const DEFAULT_KART_VEHICLE_TYPE: VehicleType = {
  id: DEFAULT_KART_VEHICLE_TYPE_ID,
  name: "Kart",
  templateId: DEFAULT_KART_TEMPLATE_ID,
  wheelCount: 4,
  isDefault: true,
  createdAt: 0,
};

/**
 * eSkateboard — RacePlex's home discipline, and the type new vehicles start on.
 *
 * Wheel diameter/width, wheel brand and (for pneumatics) pressure deliberately
 * live in the built-in tire block rather than in a section here: that block
 * already models per-corner values and feeds setup diffs and history, and many
 * belt-drive builds do run different front/rear wheels. So `includeTires` is on,
 * and the Wheels section below only carries what the tire block has no slot for.
 */
export const DEFAULT_ESKATE_TEMPLATE: SetupTemplate = {
  id: DEFAULT_ESKATE_TEMPLATE_ID,
  vehicleTypeId: DEFAULT_ESKATE_VEHICLE_TYPE_ID,
  name: "eSkateboard",
  sections: [
    {
      id: "sec-deck",
      name: "Deck",
      fields: [
        { id: "f-deck-length", name: "Deck Length", type: "number", unit: "mm", min: 600, max: 1400, step: 5 },
        // Truck-to-truck (kingpin/axle centres) — the number the Stance tool wants.
        { id: "f-wheelbase", name: "Wheelbase (truck to truck)", type: "number", unit: "mm", min: 400, max: 1000, step: 5 },
        { id: "f-deck-flex", name: "Flex", type: "string" },
        { id: "f-deck-concave", name: "Concave", type: "string" },
      ],
    },
    {
      id: "sec-trucks",
      name: "Trucks",
      fields: [
        { id: "f-truck-type", name: "Type", type: "string" },
        { id: "f-truck-width", name: "Hanger Width", type: "number", unit: "mm", min: 100, max: 350, step: 5 },
        { id: "f-baseplate-angle", name: "Baseplate Angle", type: "number", unit: "degrees", min: 20, max: 60, step: 1 },
        { id: "f-bushing-front", name: "Bushing Duro (front)", type: "number", unit: "A", min: 60, max: 100, step: 0.5 },
        { id: "f-bushing-rear", name: "Bushing Duro (rear)", type: "number", unit: "A", min: 60, max: 100, step: 0.5 },
      ],
    },
    {
      id: "sec-wheels",
      name: "Wheels",
      fields: [
        { id: "f-wheel-type", name: "Type (urethane / pneumatic)", type: "string" },
        { id: "f-wheel-duro-front", name: "Durometer (front)", type: "number", unit: "A", min: 60, max: 100, step: 1 },
        { id: "f-wheel-duro-rear", name: "Durometer (rear)", type: "number", unit: "A", min: 60, max: 100, step: 1 },
      ],
    },
    {
      id: "sec-drive",
      name: "Drive",
      fields: [
        { id: "f-drive-type", name: "Drive (belt / gear / hub / direct)", type: "string" },
        { id: "f-motor-kv", name: "Motor kV", type: "number", unit: "kV", min: 40, max: 300, step: 1 },
        // Pulley teeth rather than a ratio: teeth are what you count on the bench.
        { id: "f-motor-pulley", name: "Motor Pulley", type: "number", unit: "teeth", min: 8, max: 40, step: 1 },
        { id: "f-wheel-pulley", name: "Wheel Pulley", type: "number", unit: "teeth", min: 20, max: 100, step: 1 },
      ],
    },
    {
      id: "sec-battery",
      name: "Battery",
      fields: [
        { id: "f-cell-config", name: "Cell Config (e.g. 12S4P)", type: "string" },
        { id: "f-capacity-wh", name: "Capacity", type: "number", unit: "Wh", min: 50, max: 3000, step: 10 },
      ],
    },
    {
      id: "sec-rider",
      name: "Rider",
      fields: [
        // Rider + gear + backpack: on an eskate this is ~85% of the moving mass,
        // so it belongs on the setup sheet, not just in the rider's head.
        { id: "f-ride-weight", name: "Total Ride Weight", type: "number", unit: "kg", min: 30, max: 200, step: 0.5 },
      ],
    },
  ],
  wheelCount: 4,
  includeTires: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0,
};

export const DEFAULT_ESKATE_VEHICLE_TYPE: VehicleType = {
  id: DEFAULT_ESKATE_VEHICLE_TYPE_ID,
  name: "eSkateboard",
  templateId: DEFAULT_ESKATE_TEMPLATE_ID,
  wheelCount: 4,
  isDefault: true,
  createdAt: 0,
};

/** The type a brand-new vehicle starts on. RacePlex is an eskate app. */
export const NEW_VEHICLE_DEFAULT_TYPE_ID = DEFAULT_ESKATE_VEHICLE_TYPE_ID;

/**
 * Which vehicle type a new vehicle should default to, given what's in the
 * garage. Prefers eSkateboard, then any built-in, then whatever exists — so a
 * user who has deleted or renamed things still gets a sane pre-selection.
 */
export function defaultVehicleTypeId(types: VehicleType[]): string {
  return (
    types.find(t => t.id === NEW_VEHICLE_DEFAULT_TYPE_ID)?.id ??
    types.find(t => t.isDefault)?.id ??
    types[0]?.id ??
    ""
  );
}

// ── Seeding ──

const BUILT_INS: Array<{ type: VehicleType; template: SetupTemplate }> = [
  { type: DEFAULT_ESKATE_VEHICLE_TYPE, template: DEFAULT_ESKATE_TEMPLATE },
  { type: DEFAULT_KART_VEHICLE_TYPE, template: DEFAULT_KART_TEMPLATE },
];

function idbGetAll<T>(store: IDBObjectStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Seed any built-in type/template that isn't already in the database.
 *
 * Records are only *added*, never overwritten: an existing garage keeps its Kart
 * type (and any edits the user made to the Kart template) untouched, and simply
 * gains the eSkateboard type alongside it. Vehicles keep the `vehicleTypeId`
 * they already have — only the pre-selection for *new* vehicles changes.
 */
export async function ensureDefaults(): Promise<void> {
  const db = await openDB();

  // Both reads are issued before the first await, so the transaction can't
  // auto-commit out from under us.
  const readTx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readonly");
  const [types, templates] = await Promise.all([
    idbGetAll<VehicleType>(readTx.objectStore(STORE_NAMES.VEHICLE_TYPES)),
    idbGetAll<SetupTemplate>(readTx.objectStore(STORE_NAMES.SETUP_TEMPLATES)),
  ]);
  const haveType = new Set(types.map((t) => t.id));
  const haveTemplate = new Set(templates.map((t) => t.id));

  const missing = BUILT_INS.filter((b) => !haveType.has(b.type.id) || !haveTemplate.has(b.template.id));
  if (missing.length) {
    const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
    for (const b of missing) {
      if (!haveType.has(b.type.id)) tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(b.type);
      if (!haveTemplate.has(b.template.id)) tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(b.template);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  db.close();
}

// ── Vehicle Type CRUD ──

/**
 * All vehicle types visible to the active user (plan 0011): user-owned rows,
 * plus any row without a userId (built-ins seeded by `ensureDefaults`).
 */
export async function listVehicleTypes(): Promise<VehicleType[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readonly");
  const req = tx.objectStore(STORE_NAMES.VEHICLE_TYPES).getAll();
  const results = await new Promise<VehicleType[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results.filter((vt) => vt.userId === uid || !vt.userId);
}

export async function getVehicleType(id: string): Promise<VehicleType | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readonly");
  const req = tx.objectStore(STORE_NAMES.VEHICLE_TYPES).get(id);
  const result = await new Promise<VehicleType | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result ?? null;
}

export async function saveVehicleType(vt: VehicleType): Promise<void> {
  const stamped: VehicleType = {
    ...vt,
    userId: vt.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.VEHICLE_TYPES, key: vt.id, type: "put" });
}

export async function deleteVehicleType(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.VEHICLE_TYPES, "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.VEHICLE_TYPES, key: id, type: "delete" });
}

// ── Setup Template CRUD ──

/**
 * All setup templates visible to the active user (plan 0011): user-owned rows,
 * plus any row without a userId (built-ins seeded by `ensureDefaults`).
 */
export async function listTemplates(): Promise<SetupTemplate[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readonly");
  const req = tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).getAll();
  const results = await new Promise<SetupTemplate[]>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  const uid = activeUserIdOrDefault();
  return results.filter((t) => t.userId === uid || !t.userId);
}

export async function getTemplate(id: string): Promise<SetupTemplate | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readonly");
  const req = tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).get(id);
  const result = await new Promise<SetupTemplate | undefined>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result ?? null;
}

export async function saveTemplate(template: SetupTemplate): Promise<void> {
  const stamped: SetupTemplate = {
    ...template,
    userId: template.userId ?? activeUserIdOrDefault(),
    updatedAt: Date.now(),
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readwrite");
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(stamped);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.SETUP_TEMPLATES, key: template.id, type: "put" });
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAMES.SETUP_TEMPLATES, "readwrite");
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.SETUP_TEMPLATES, key: id, type: "delete" });
}

/**
 * Create a new vehicle type + template atomically.
 * Returns the created vehicle type and template.
 */
export async function createVehicleTypeWithTemplate(
  name: string,
  wheelCount: 2 | 4,
  includeTires: boolean,
  sections: TemplateSection[],
): Promise<{ vehicleType: VehicleType; template: SetupTemplate }> {
  const now = Date.now();
  const vtId = makeId();
  const tplId = makeId();
  const uid = activeUserIdOrDefault();

  const vehicleType: VehicleType = {
    id: vtId,
    name,
    templateId: tplId,
    wheelCount,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    userId: uid,
  };

  const template: SetupTemplate = {
    id: tplId,
    vehicleTypeId: vtId,
    name,
    sections,
    wheelCount,
    includeTires,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    userId: uid,
  };

  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(vehicleType);
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(template);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.VEHICLE_TYPES, key: vehicleType.id, type: "put" });
  emitGarageChange({ store: STORE_NAMES.SETUP_TEMPLATES, key: template.id, type: "put" });

  return { vehicleType, template };
}

/**
 * Update an existing vehicle type and its template atomically. Both records
 * keep their ids (and the template keeps its `field.id`s, so existing setups
 * stay mapped). Stamps `updatedAt` on both so the cloud's last-write-wins
 * reconcile pushes the edit up.
 */
export async function updateVehicleTypeWithTemplate(
  vehicleType: VehicleType,
  template: SetupTemplate,
): Promise<void> {
  const now = Date.now();
  // Preserve whatever userId the caller passed in — including `undefined` for
  // built-in rows, which must stay shared across every local user. A user
  // editing a built-in in place does NOT convert it into a private row.
  const vt: VehicleType = { ...vehicleType, updatedAt: now };
  const tpl: SetupTemplate = { ...template, updatedAt: now };

  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).put(vt);
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).put(tpl);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.VEHICLE_TYPES, key: vt.id, type: "put" });
  emitGarageChange({ store: STORE_NAMES.SETUP_TEMPLATES, key: tpl.id, type: "put" });
}

/**
 * Delete a vehicle type and its template atomically.
 */
export async function deleteVehicleTypeWithTemplate(vehicleTypeId: string, templateId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_NAMES.VEHICLE_TYPES, STORE_NAMES.SETUP_TEMPLATES], "readwrite");
  tx.objectStore(STORE_NAMES.VEHICLE_TYPES).delete(vehicleTypeId);
  tx.objectStore(STORE_NAMES.SETUP_TEMPLATES).delete(templateId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  emitGarageChange({ store: STORE_NAMES.VEHICLE_TYPES, key: vehicleTypeId, type: "delete" });
  emitGarageChange({ store: STORE_NAMES.SETUP_TEMPLATES, key: templateId, type: "delete" });
}
