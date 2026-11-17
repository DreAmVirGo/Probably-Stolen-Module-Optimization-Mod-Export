import type { InventoryItem, Stats } from './types';

// These are the legacy solution format's signed 12-bit progress bounds, not a
// fresh module's natural cap. A worn/boosted value may exceed that natural cap.
export const MIN_MODULE_STAT = -2048;
export const MAX_MODULE_STAT = 2047;
const KEYS = ['Performance', 'Quality', 'Efficiency'] as const;

export const validateModuleStats = (stats: unknown): stats is Stats => {
    if (stats === null || typeof stats !== 'object' || Array.isArray(stats)) return false;
    const values = stats as Record<string, unknown>;
    return KEYS.every(key => typeof values[key] === 'number' && Number.isSafeInteger(values[key])
        && values[key] >= MIN_MODULE_STAT && values[key] <= MAX_MODULE_STAT);
};

const primaryStat = (item: InventoryItem): keyof Stats | null => item.color === 'Red' || item.color === 'Purple' ? 'Performance'
    : item.color === 'Yellow' ? 'Quality' : item.color === 'Green' ? 'Efficiency' : null;

/**
 * Correct this optimizer's own current stats without changing the item's game
 * identity or inventing a permanent Turbocharger multiplier. The snapshot is
 * AFTER internal effects and BEFORE board neighbours/mounts/receivers.
 *
 * A progressing universal module uses its colour's current nonnegative primary
 * stat as the displayed progression scalar. If no such scalar is meaningful,
 * retain the original metadata; the complete currentStats snapshot still wins.
 *
 * Legacy solution codes do not carry currentStats. Save-module mod exports use
 * the real game uid and cells, so they move the existing item with its actual
 * game stats. A later authoritative save import can replace this local edit.
 */
export const editInventoryItem = (item: InventoryItem, stats: Stats): InventoryItem => {
    if (!validateModuleStats(stats)) throw new RangeError(`Module stats must be whole numbers from ${MIN_MODULE_STAT} to ${MAX_MODULE_STAT}.`);
    const currentStats: Stats = { Performance: stats.Performance, Quality: stats.Quality, Efficiency: stats.Efficiency };
    const primary = primaryStat(item);
    const value = primary === null ? null : currentStats[primary];
    const effectValues = item.effectValues.map((existing, slot) => value !== null && value >= 0
        && (item.effects[slot] === 'Degrading' || item.effects[slot] === 'Learning Algorithm') ? value : existing) as [number, number];
    return { ...item, currentStats, effectValues };
};
