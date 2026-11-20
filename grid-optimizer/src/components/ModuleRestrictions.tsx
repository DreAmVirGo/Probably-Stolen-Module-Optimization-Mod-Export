import type { ItemEffect } from '../types';
import type { RestrictedModuleEffect } from '../moduleRestrictions';
import { plural, t, useLang } from '../i18n';

const CHOICES: { effect: RestrictedModuleEffect; label: string }[] = [
    { effect: 'Degrading', label: 'Ban Degrading' },
    { effect: 'Overcharged', label: 'Ban Overcharged' },
];

export const ModuleRestrictions = ({ forbiddenEffects, onToggle, disabled, movableCount, pinnedCount, usesBloomFallback }: {
    forbiddenEffects: readonly ItemEffect[];
    onToggle: (effect: RestrictedModuleEffect, forbidden: boolean) => void;
    disabled: boolean;
    movableCount: number;
    pinnedCount: number;
    usesBloomFallback: boolean;
}) => {
    useLang();
    const hasRestrictions = CHOICES.some(({ effect }) => forbiddenEffects.includes(effect));
    return (
        <div role="group" aria-label={t('Module restrictions')} data-module-restrictions="true"
            style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px',
                fontSize: '0.72em', lineHeight: 1.4, color: '#aaa', overflowWrap: 'anywhere' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px' }}>
                {CHOICES.map(({ effect, label }) => {
                    const forbidden = forbiddenEffects.includes(effect);
                    return (
                        <label key={effect} title={t('Block {effect} modules when optimizing, storing or placing modules on this machine.', { effect: t(effect) })}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 6px', borderRadius: '4px',
                                border: `1px solid ${forbidden ? '#80632e' : '#3a3a3a'}`, background: forbidden ? '#302719' : '#1a1a1a',
                                color: forbidden ? '#edcb8b' : '#bbb', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
                            <input type="checkbox" checked={forbidden} disabled={disabled}
                                onChange={event => { if (!disabled) onToggle(effect, event.target.checked); }}
                                style={{ accentColor: '#d6b176' }} />
                            {t(label)}
                        </label>
                    );
                })}
            </div>
            {hasRestrictions && movableCount > 0 && <div>{t('The next optimization removes {n} movable banned module{s} from this machine.', { n: movableCount, s: plural(movableCount) })}</div>}
            {hasRestrictions && pinnedCount > 0 && <div style={{ color: '#d6b176' }}>{t('Locked or stuck banned modules stay in place: {n}.', { n: pinnedCount })}</div>}
            {hasRestrictions && usesBloomFallback && <div style={{ color: '#999' }}>{t('Uses Bloom while these module bans are enabled.')}</div>}
        </div>
    );
};
