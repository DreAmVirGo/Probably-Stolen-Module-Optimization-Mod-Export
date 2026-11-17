import type { InventoryItem } from './types';
import { getModuleProgressMax } from './moduleProgress';

export type LearningProgress = { current: number; cap: number };

/**
 * The saved current learning value, compared with the normal shaped module's
 * ceiling. A saved baseStats snapshot contains today's stats, so it must not
 * become a new base for calculating the ceiling. This reports progress only;
 * being on a board does not prove that the machine has been used in the game.
 */
export const getLearningProgress = (item: InventoryItem): LearningProgress | null => {
    const slot = item.effects.indexOf('Learning Algorithm');
    if (slot < 0 || item.effects.lastIndexOf('Learning Algorithm') !== slot) return null;
    const current = item.effectValues[slot];
    if (!Number.isInteger(current) || current < 0) return null;
    const cap = getModuleProgressMax({ shape: item.shape, color: item.color, displayName: item.displayName }, item.effects);
    if (!Number.isFinite(cap) || cap <= 0) return null;
    return { current, cap };
};

/** Deal Maker never triggers the native per-use module effects. */
export const canMachineTrainLearning = (machineType: string): boolean => {
    const name = machineType.split(' > ').at(-1)!.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+\d+$/, '').trim();
    return name !== 'deal maker';
};

export type LearningMachine = {
    id: string;
    name: string;
    board: readonly (readonly (InventoryItem | 'Locked' | null)[])[];
    canTrainLearning?: boolean;
};

export type LearningStatusEntry = LearningProgress & {
    id: string;
    name: string;
    uid?: number;
    machineId: string | null;
    machineName: string | null;
    canTrainLearning: boolean | null;
};

export type LearningSummary = {
    count: number;
    placedCount: number;
    idleCount: number;
    blockedCount: number;
    entries: LearningStatusEntry[];
};

const physicalKey = (item: InventoryItem) => Number.isSafeInteger(item.uid) && item.uid! >= 0
    ? `uid:${item.uid}` : `id:${item.id}`;
const realItem = (item: InventoryItem) => Boolean(item.id) && !item.isInfinite && !item.id.includes('_clone_');

/**
 * Coverage of every owned, unfinished learning module across every machine.
 * Locked/stopped cards still count as placed: only actual machine use advances
 * learning. Repeated board cells, duplicate inventory records and clone items
 * cannot increase the number of physical modules reported.
 */
export const summariseLearning = (inventory: readonly InventoryItem[], machines: readonly LearningMachine[]): LearningSummary => {
    const inventoryById = new Map(inventory.filter(realItem).map(item => [item.id, item]));
    const placements = new Map<string, LearningMachine>();
    for (const machine of machines) {
        for (const row of machine.board) for (const cell of row) {
            if (!cell || cell === 'Locked' || !realItem(cell)) continue;
            const canonical = inventoryById.get(cell.id) ?? cell;
            const key = physicalKey(canonical);
            if (!placements.has(key)) placements.set(key, machine);
        }
    }
    const entries: LearningStatusEntry[] = [];
    const seen = new Set<string>();
    for (const item of inventory) {
        if (!realItem(item)) continue;
        const key = physicalKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        const progress = getLearningProgress(item);
        if (!progress || progress.current >= progress.cap) continue;
        const machine = placements.get(key);
        entries.push({
            id: item.id, name: item.displayName, uid: item.uid, ...progress,
            machineId: machine?.id ?? null, machineName: machine?.name ?? null,
            canTrainLearning: machine ? machine.canTrainLearning !== false : null,
        });
    }
    const placedCount = entries.filter(entry => entry.machineId !== null).length;
    const blockedCount = entries.filter(entry => entry.canTrainLearning === false).length;
    return { count: entries.length, placedCount, idleCount: entries.length - placedCount, blockedCount, entries };
};
