export type RunningJobKind = 'hydroponic' | 'printer' | 'dna' | 'desequencer';
export type RunningJob = {
    active: true;
    kind: RunningJobKind;
    // Native machine work, rather than the presence of a seed/chip in inventory.
    current: number;
    required: number;
    importedDay: number | null;
    jobKey?: string;
    // Game uid of the machine from which this progress record was imported.
    sourceUid?: number;
};

type SaveTag = {
    valueEnabled?: boolean;
    valueInt?: unknown;
    internalValueString?: unknown;
    '<identifier>k__BackingField'?: string;
};
export type RunningJobSaveItem = {
    identifier?: string;
    uniqueId?: unknown;
    _keys?: string[];
    _values?: (SaveTag | null | undefined)[];
};

export const runningJobKey = (machineId: string) => `optimizer_running_job_${machineId}`;

const tag = (item: RunningJobSaveItem, key: string) => {
    const index = item._keys?.indexOf(key) ?? -1;
    const value = index >= 0 ? item._values?.[index] : item._values?.find(candidate => candidate?.['<identifier>k__BackingField'] === key);
    return { listed: index >= 0 || value !== undefined, value };
};
const enabledTag = (item: RunningJobSaveItem, key: string) => {
    const found = tag(item, key);
    return found.listed && found.value?.valueEnabled !== false;
};
const tagValue = (item: RunningJobSaveItem, key: string) => {
    const found = tag(item, key);
    return found.value?.valueEnabled !== false ? found.value : null;
};
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validDay = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validProgress = (current: unknown, required: unknown): current is number => finiteNumber(current) && finiteNumber(required)
    && current >= 0 && required > 0 && current < required;
const kindOf = (name: string): RunningJobKind | null => {
    const lower = name.toLowerCase();
    if (lower.includes('hydroponic')) return 'hydroponic';
    if (lower.includes('desequencer')) return 'desequencer';
    if (lower.includes('dna') && lower.includes('manipulator')) return 'dna';
    if (lower.includes('printer')) return 'printer';
    return null;
};

/**
 * Native progress machines explicitly distinguish STATE_READY from STATE_WORKING.
 * Require the working flag AND the machine's unfinished progress counters. Input
 * items and a child's growing progress are never sufficient evidence of a busy bay.
 * Source: Nwflower/item-details MachineAdapters.Progress, a157a9e (GameRead.TagInt/
 * TagString around MachineProgressHelper.ContinueProgressTypeMachine).
 */
export const readRunningJob = (
    machineType: string,
    machine: RunningJobSaveItem,
    importedDay: number | null,
    jobKey?: string,
): RunningJob | null => {
    const kind = kindOf(machineType || machine.identifier || '');
    if (!kind || !enabledTag(machine, 'PROGRESS_TYPE_MACHINE_TAG')) return null;
    if (tagValue(machine, 'MACHINE_STATE_TAG')?.internalValueString !== 'STATE_WORKING') return null;
    const current = tagValue(machine, 'MACHINE_PROGRESS_CURRENT_TAG')?.valueInt;
    const required = tagValue(machine, 'MACHINE_PROGRESS_TARGET_TAG')?.valueInt;
    if (!validProgress(current, required)) return null;
    return {
        active: true, kind, current, required: required as number,
        importedDay: validDay(importedDay) ? importedDay : null,
        ...(jobKey ? { jobKey } : {}),
        ...(validDay(machine.uniqueId) ? { sourceUid: machine.uniqueId } : {}),
    };
};

export const readStoredRunningJob = (machineId: string): RunningJob | null => {
    try {
        const value = JSON.parse(localStorage.getItem(runningJobKey(machineId)) || 'null');
        if (!value || value.active !== true || !['hydroponic', 'printer', 'dna', 'desequencer'].includes(value.kind)
            || !validProgress(value.current, value.required)) return null;
        return {
            active: true, kind: value.kind, current: value.current, required: value.required,
            importedDay: validDay(value.importedDay) ? value.importedDay : null,
            ...(typeof value.jobKey === 'string' && value.jobKey ? { jobKey: value.jobKey } : {}),
            ...(validDay(value.sourceUid) ? { sourceUid: value.sourceUid } : {}),
        };
    } catch { return null; }
};

// Derived save metadata is always replaced by the latest import. It is kept
// separately from manual machine locks and never restored from saved settings.
export const writeImportedRunningJob = (machineId: string, job: RunningJob | null | undefined): void => {
    try {
        if (job) localStorage.setItem(runningJobKey(machineId), JSON.stringify(job));
        else localStorage.removeItem(runningJobKey(machineId));
    } catch { /* no reliable saved metadata: the reader leaves the card unlocked */ }
};
