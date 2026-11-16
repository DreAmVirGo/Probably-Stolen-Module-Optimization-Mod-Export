import type { InventoryItem } from './types';

export type InventoryRemovalContext = {
    itemId: string;
    inventory: readonly InventoryItem[];
    usedIds: ReadonlySet<string>;
    isSolving: boolean;
    isDragging: boolean;
    boardsReady: boolean;
};
export type InventoryRemovalBlock = 'busy' | 'unready' | 'missing' | 'clone' | 'stuck' | 'placed';

const belongsTo = (id: string, source: string) => id === source || id.startsWith(`${source}_clone_`);

// Call again when the final confirmation is accepted: the storage list is throttled
// and a module may have been placed since the menu/dialog was opened.
export const inventoryRemovalReason = ({ itemId, inventory, usedIds, isSolving, isDragging, boardsReady }: InventoryRemovalContext): InventoryRemovalBlock | null => {
    if (isSolving || isDragging) return 'busy';
    if (!boardsReady) return 'unready';
    if (itemId.includes('_clone_')) return 'clone';
    const item = inventory.find(candidate => candidate.id === itemId);
    if (!item) return 'missing';
    if (item.isStuck) return 'stuck';
    for (const used of usedIds) if (belongsTo(used, itemId)) return 'placed';
    // isLocked only pins a module to a machine while placed. Imported specials
    // begin locked even in storage, and can be removed from the optimizer there.
    return null;
};

export type StoredInventoryLayouts = Record<string, {
    before: (string | null)[][];
    after: (string | null)[][];
}>;

// Local optimizer inventory only. The next game-save import is authoritative;
// deliberately keep no deletion blacklist or game-uid tombstones.
// Eligibility is checked separately against live boards at final confirmation.
export const removeInventoryItem = (
    itemId: string,
    inventory: InventoryItem[],
    storedIds: string[],
    storedLayouts: StoredInventoryLayouts,
): { inventory: InventoryItem[]; storedIds: string[]; storedLayouts: StoredInventoryLayouts } => {
    if (!inventory.some(item => item.id === itemId)) return { inventory, storedIds, storedLayouts };
    const containsRemoved = (grid: (string | null)[][]) => grid.some(row => row.some(id => id !== null && belongsTo(id, itemId)));
    return {
        inventory: inventory.filter(item => !belongsTo(item.id, itemId)),
        storedIds: storedIds.filter(id => !belongsTo(id, itemId)),
        // Invalidating an affected Store undo record makes Retrieve use its normal
        // removal path instead of resurrecting an old board snapshot.
        storedLayouts: Object.fromEntries(Object.entries(storedLayouts).filter(([, layout]) => !containsRemoved(layout.before) && !containsRemoved(layout.after))),
    };
};
