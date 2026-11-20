import type { InventoryItem, ItemEffect } from './types';

const RESTRICTABLE_EFFECTS = ['Degrading', 'Overcharged'] as const;
export type RestrictedModuleEffect = typeof RESTRICTABLE_EFFECTS[number];

export const machineRestrictionsKey = (id: string) => `optimizer_forbidden_effects_${id}`;

export const readForbiddenEffects = (id: string): RestrictedModuleEffect[] => {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(machineRestrictionsKey(id)) ?? 'null');
        return Array.isArray(saved) ? RESTRICTABLE_EFFECTS.filter(effect => saved.includes(effect)) : [];
    } catch { return []; }
};

export const allowsModuleEffects = (item: Pick<InventoryItem, 'effects'>, forbiddenEffects?: readonly ItemEffect[]) =>
    !forbiddenEffects?.some(effect => item.effects.includes(effect));
