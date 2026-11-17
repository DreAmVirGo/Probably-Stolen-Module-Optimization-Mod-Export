import type { InventoryItem } from './types';

/**
 * Degrading loses one percentage point of its remaining positive stat per use,
 * stopping at zero (the progression documented in AddModuleMenu).
 * Also matches the public advisor forecast's Degrading branch (positive
 * BaseStats--): https://github.com/mcxufly/probably-stolen-module-advisor/blob/main/src/TemporalSimulation.cs
 * One active night is treated as one use. Learning gains are deliberately not
 * credited: a target must remain safe without depending on future training.
 *
 * Keep the module's identity and effects so the normal board evaluator still
 * applies receivers, mounts, nodes and negative feedback, including their own
 * rounding, to the projected value. Never mutate the imported save inventory.
 */
export const projectDegradation = (item: InventoryItem, uses: number): InventoryItem => {
    if (!Number.isFinite(uses) || uses <= 0 || !item.effects.includes('Degrading')) return item;
    const elapsed = Math.floor(uses);
    if (elapsed === 0) return item;
    // The native per-use effect loop processes every Degrading occurrence. Each
    // slot consumes one point from the shared current positive reading per use.
    const count = item.effects.filter(effect => effect === 'Degrading').length;
    const loss = elapsed * count;
    const effectValues = item.effectValues.map((value, slot) => item.effects[slot] === 'Degrading' && Number.isFinite(value)
        ? Math.max(0, Math.trunc(value) - loss)
        : value) as [number, number];
    let currentStats = item.currentStats;
    if (currentStats) {
        const age = (value: number) => value > 0 ? Math.max(0, value - loss) : value;
        currentStats = { Performance: age(currentStats.Performance), Quality: age(currentStats.Quality), Efficiency: age(currentStats.Efficiency) };
    }
    const statsChanged = currentStats && (['Performance', 'Quality', 'Efficiency'] as const).some(key => currentStats[key] !== item.currentStats![key]);
    if (!statsChanged && effectValues.every((value, slot) => value === item.effectValues[slot])) return item;
    return { ...item, effectValues, ...(currentStats ? { currentStats } : {}) };
};

/** Number of uses until every Degrading value in this inventory reaches zero. */
export const degradationLifetime = (items: Iterable<InventoryItem>): number => {
    let last = 0;
    for (const item of items) {
        const count = item.effects.filter(effect => effect === 'Degrading').length;
        if (count === 0) continue;
        if (item.currentStats) {
            const positive = Math.max(0, item.currentStats.Performance, item.currentStats.Quality, item.currentStats.Efficiency);
            if (Number.isFinite(positive)) last = Math.max(last, Math.ceil(positive / count));
        } else {
            item.effects.forEach((effect, slot) => {
                const value = item.effectValues[slot];
                if (effect === 'Degrading' && Number.isFinite(value)) last = Math.max(last, Math.ceil(Math.max(0, Math.trunc(value)) / count));
            });
        }
    }
    return last;
};

/**
 * First whole use at which a monotonically nonincreasing reading is strictly
 * below its target. Equality is safe. maxUses may be the inventory's lifetime
 * (to find any eventual failure) or the protected time horizon. The evaluator
 * should run the normal board calculation on projected modules so rounding and
 * changes when a module reaches zero are retained.
 */
export const firstThresholdFailure = (valueAt: (uses: number) => number, threshold: number, maxUses: number): number | null => {
    if (valueAt(0) < threshold) return 0;
    const end = Number.isFinite(maxUses) ? Math.max(0, Math.floor(maxUses)) : 0;
    if (end === 0 || valueAt(end) >= threshold) return null;
    let low = 1, high = end;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (valueAt(middle) < threshold) high = middle;
        else low = middle + 1;
    }
    return low;
};
