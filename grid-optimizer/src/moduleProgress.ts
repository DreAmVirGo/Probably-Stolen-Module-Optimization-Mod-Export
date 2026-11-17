import type { InventoryItem, ItemEffect } from './types';
import { applyInternalEffects } from './utils';

const progressing = (effect: ItemEffect) => effect === 'Degrading' || effect === 'Learning Algorithm';

// Fresh creation and a saved current value are different operations. Degrading
// starts by doubling the shaped stats; the other effect still initializes in
// its own slot, including modifiers AFTER Degrading. Learning's ceiling is the
// same double base (its compatible placement effects do not change that base).
// evaluate the ordinary static multipliers to retain per-slot game rounding.
// Never use this cap to rewrite an imported module's current effectValues.
export const getModuleProgressMax = (
    template: Pick<InventoryItem, 'shape' | 'color' | 'displayName'>,
    effects: readonly ItemEffect[],
): number => {
    if (!effects.some(progressing)) return 0;
    const initialEffect = (effect: ItemEffect = 'None'): ItemEffect => progressing(effect) ? 'Overcharged' : effect;
    const stats = applyInternalEffects({
        ...template, id: 'progress_initialization',
        effects: [initialEffect(effects[0]), initialEffect(effects[1])], effectValues: [0, 0],
    });
    return Math.max(0, stats.Performance, stats.Quality, stats.Efficiency);
};
