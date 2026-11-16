import type { Stats } from './types';
import type { StatUnit } from './machineDefaults';

// Targets are encoded as signed 12-bit whole percentages in solution codes.
// Validate before saving so a hand-entered target cannot wrap during export.
export const parseTargetValue = (text: string, unit: StatUnit | null, totals: Stats): { value: number; error?: never } | { value?: never; error: string } => {
    const value = Number(text);
    if (!text.trim() || !Number.isFinite(value)) return { error: 'Enter a finite number.' };
    if (unit && (value < (unit.min ?? -Infinity) || value > (unit.max ?? Infinity))) {
        return { error: 'This value is outside the supported range for this stat.' };
    }
    const converted = Math.ceil(unit ? unit.toPercent(value, totals) : value);
    if (!Number.isFinite(converted)) return { error: 'This target cannot be reached in this unit.' };
    if (converted < -2048 || converted > 2047) return { error: 'Target must be between -2048% and 2047%.' };
    if (unit) {
        const actual = unit.fromPercent(converted, totals);
        if (!Number.isFinite(actual) || (unit.lowerIsBetter ? actual > value : actual < value)) {
            return { error: 'This target cannot be reached in this unit.' };
        }
    }
    return { value: converted };
};
