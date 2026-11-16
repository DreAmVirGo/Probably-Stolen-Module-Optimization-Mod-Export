// Machine settings remembered per save (localStorage), so importing the same save again (after playing on, or in a later visit)
// brings back each card's Auto / target / off choices, its Limit and Desequencer choices, its lock, the modules locked to it (by
// the game's module uid, and only while the module is still in that machine) and the card order (priority).
// Saves share settings by slot, so renamed downloads and day backups retain their card order.
// A machine is known by its stable game uid. Older settings and machines
// without a uid use the name/path and its occurrence as a fallback.
import { SAVE_NAME_KEY, SAVE_SLOT_KEY, machineUidKey } from './modExport';
import { desequencerAutoDaysKey, desequencerChipsetKey, machineJobKey } from './machineDefaults';

const settingsKey = (save: string) => `optimizer_save_settings_${save}`;
const slotSettingsKey = (slot: number | null | undefined) => typeof slot === 'number' && Number.isSafeInteger(slot) && slot >= 0
    ? `optimizer_save_slot_settings_${slot}` : null;

type MachineSettings = {
    // Retained only to match older imports without game uids.
    nameKey?: string;
    // tier, maximizeStats, targetStats, ignoreStats, statPriority, as useOptimizer keeps them (without the board)
    state: Record<string, unknown> | null;
    limit: string | null;
    chipset: string | null;
    autoDays: string | null;
    degradationDays?: string | null;
    // The Hydroponic plant, DNA complexity or 3D Printer chip picked on its cards (machineJobs)
    job?: string | null;
    locked: string | null;
    lockedUids?: number[];
    // Modules on this machine that are unlocked: the specials start locked, so an unlocked one has to be remembered too
    unlockedUids?: number[];
    // Each solver's own goals for this card (ModuleInventoryUI: optimizer_goals_<solver>_<id>)
    goals?: Record<string, string | null>;
};
const SOLVER_KINDS = ['bloom', 'razboy', 'hoydoy'];
const goalsKey = (kind: string, id: string) => `optimizer_goals_${kind}_${id}`;
type SaveSettings = { order: string[]; machines: Record<string, MachineSettings> };

const get = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const set = (key: string, value: string | null) => {
    try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

// "name#n": the n-th machine (from 0) with that name in the save file, so two machines with the same name keep their own settings.
// Given at import and kept per card (cardKey), so reordering the cards does not swap them
const cardKey = (id: string) => `optimizer_machine_savekey_${id}`;
const uidKey = (uid: number | undefined) => typeof uid === 'number' && Number.isFinite(uid) ? `uid:${uid}` : null;
const storedUidKey = (id: string) => {
    const value = get(machineUidKey(id));
    return value !== null && value.trim() !== '' ? uidKey(Number(value)) : null;
};
const keyed = (names: string[]) => {
    const seen = new Map<string, number>();
    return names.map(name => { const n = seen.get(name) ?? 0; seen.set(name, n + 1); return `${name}#${n}`; });
};

const snapshot = () => {
    const save = get(SAVE_NAME_KEY);
    if (!save) return;
    let ids: string[];
    try { ids = (JSON.parse(get('optimizer_machine_list') || '[]') as { id: string }[]).map(m => m.id); } catch { return; }
    // Cards with no machine picked yet have nothing to remember
    ids = ids.filter(id => get(`optimizer_machine_type_${id}`));
    if (ids.length === 0) return;
    const fallback = keyed(ids.map(id => get(`optimizer_machine_type_${id}`)!));
    const nameKeys = ids.map((id, i) => {
        const saved = get(cardKey(id));
        return saved && !saved.startsWith('uid:') ? saved : fallback[i];
    });
    const keys = ids.map((id, i) => storedUidKey(id) ?? nameKeys[i]);
    const settings: SaveSettings = { order: keys, machines: {} };
    // Modules locked to a machine (right-click), by uid
    const uidById = new Map<string, number>();
    const lockedIds = new Set<string>();
    try {
        for (const item of JSON.parse(get('optimizer_inventory') || '[]')) {
            if (typeof item.uid !== 'number') continue;
            uidById.set(item.id, item.uid);
            if (item.isLocked) lockedIds.add(item.id);
        }
    } catch { /* none */ }
    ids.forEach((id, i) => {
        let state: Record<string, unknown> | null = null;
        let lockedUids: number[] = [], unlockedUids: number[] = [];
        try {
            const { boardIds, ...rest } = JSON.parse(get(`optimizer_machine_${id}`) || 'null') ?? {};
            state = rest;
            const onBoard = new Set<string>((boardIds ?? []).flat());
            const onBoardUids = [...onBoard].filter(c => uidById.has(c));
            lockedUids = onBoardUids.filter(c => lockedIds.has(c)).map(c => uidById.get(c)!);
            unlockedUids = onBoardUids.filter(c => !lockedIds.has(c)).map(c => uidById.get(c)!);
        } catch { /* keep null */ }
        settings.machines[keys[i]] = {
            nameKey: nameKeys[i],
            state,
            limit: get(`optimizer_limit_${id}`),
            chipset: get(desequencerChipsetKey(id)),
            autoDays: get(desequencerAutoDaysKey(id)),
            degradationDays: get(`optimizer_degradation_days_${id}`),
            job: get(machineJobKey(id)),
            locked: get(`optimizer_machine_locked_${id}`),
            lockedUids,
            unlockedUids,
            goals: Object.fromEntries(SOLVER_KINDS.map(kind => [kind, get(goalsKey(kind, id))])),
        };
    });
    const encoded = JSON.stringify(settings);
    set(settingsKey(save), encoded);
    const slotText = get(SAVE_SLOT_KEY);
    const slotKey = slotText !== null && slotText.trim() !== '' ? slotSettingsKey(Number(slotText)) : null;
    if (slotKey) set(slotKey, encoded);
};

let timer: ReturnType<typeof setTimeout> | null = null;
// Called wherever a card's settings are written; the snapshot is taken once things settle
export const rememberSaveSettings = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; snapshot(); }, 300);
};
// Before another save is imported: what is pending belongs to the save still loaded
export const flushSaveSettings = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    // Import must use the current card order even when no debounced write is pending (for example after a reload).
    snapshot();
};

type Imported = { uid?: number; id: string; machineType: string; tier: unknown; boardIds: (string | null)[][]; job?: string };

/* For a save being imported: puts back what was remembered for its machines (under their new card ids) and returns them in the
 * remembered card order, machines new to the save last. `defaults` is each machine's fresh state, used for anything not remembered
 * (and always for the tier and board, which come from the save). `lock` gets the save's modules (`items`, by id) whose lock to set
 */
export const restoreSaveSettings = <M extends Imported>(save: string, machines: M[], defaults: (m: M) => Record<string, unknown>,
    items: { id: string; uid?: number }[], lock: (locks: Map<string, boolean>) => void, saveSlot?: number | null): M[] => {
    const uids = new Map(items.map(it => [it.id, it.uid]));
    const uidOf = (id: string) => uids.get(id);
    let settings: SaveSettings | null = null;
    const slotKey = slotSettingsKey(saveSlot);
    // The latest order for this slot wins over an older snapshot of a particular backup filename.
    try { settings = JSON.parse((slotKey ? get(slotKey) : null) || get(settingsKey(save)) || 'null'); } catch { /* nothing remembered */ }
    const nameKeys = keyed(machines.map(m => m.machineType));
    const keys = machines.map((m, i) => uidKey(m.uid) ?? nameKeys[i]);
    // Before uids were used, every entry was keyed by its path. Migrate those entries on their next import.
    // A machine with a different uid must never inherit a previous machine's goals merely because its path was reused.
    const rememberedKeys = machines.map((m, i) => {
        if (settings?.machines[keys[i]]) return keys[i];
        if (settings?.machines[nameKeys[i]]) return nameKeys[i];
        if (uidKey(m.uid)) return keys[i];
        return Object.keys(settings?.machines ?? {}).find(k => settings!.machines[k].nameKey === nameKeys[i]) ?? keys[i];
    });
    const locks = new Map<string, boolean>();
    machines.forEach((m, i) => {
        const fresh = defaults(m);
        const s = settings?.machines[rememberedKeys[i]];
        set(`optimizer_machine_${m.id}`, JSON.stringify(s?.state ? { ...fresh, ...s.state, tier: fresh.tier, boardIds: fresh.boardIds } : fresh));
        set(`optimizer_limit_${m.id}`, s?.limit ?? null);
        set(desequencerChipsetKey(m.id), s?.chipset ?? null);
        set(desequencerAutoDaysKey(m.id), s?.autoDays ?? null);
        set(`optimizer_degradation_days_${m.id}`, s?.degradationDays ?? null);
        // What the save has the machine working on wins over the job remembered for it
        set(machineJobKey(m.id), m.job ?? s?.job ?? null);
        set(`optimizer_machine_locked_${m.id}`, s?.locked ?? null);
        set(cardKey(m.id), nameKeys[i]);
        set(machineUidKey(m.id), typeof m.uid === 'number' && Number.isFinite(m.uid) ? String(m.uid) : null);
        for (const kind of SOLVER_KINDS) set(goalsKey(kind, m.id), s?.goals?.[kind] ?? null);
        for (const c of m.boardIds.flat()) {
            if (!c) continue;
            const uid = uidOf(c);
            if (uid === undefined) continue;
            if (s?.lockedUids?.includes(uid)) locks.set(c, true);
            else if (s?.unlockedUids?.includes(uid)) locks.set(c, false);
        }
    });
    lock(locks);
    if (!settings) return machines;
    const rank = new Map(settings.order.map((k, i) => [k, i]));
    return machines
        .map((m, i) => ({ m, r: rank.get(rememberedKeys[i]) ?? settings!.order.length + i }))
        .sort((a, b) => a.r - b.r)
        .map(x => x.m);
};
