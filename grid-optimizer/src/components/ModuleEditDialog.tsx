import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InventoryItem, Stats } from '../types';
import { COLOR_MAP } from '../constants';
import { applyInternalEffects } from '../utils';
import { MAX_MODULE_STAT, MIN_MODULE_STAT, validateModuleStats } from '../inventoryEditing';
import { moduleName, t, useLang } from '../i18n';
import MiniShape from './MiniShape';

const STATS = ['Performance', 'Quality', 'Efficiency'] as const;
type Draft = Record<keyof Stats, string>;
const readDraft = (item: InventoryItem | null): Draft => {
    const stats = item ? applyInternalEffects(item) : { Performance: 0, Quality: 0, Efficiency: 0 };
    return { Performance: String(stats.Performance), Quality: String(stats.Quality), Efficiency: String(stats.Efficiency) };
};

type Props = {
    item: InventoryItem | null;
    disabled: boolean;
    error?: string | null;
    onCancel: () => void;
    onConfirm: (id: string, stats: Stats) => void;
};

// A different module gets a fresh draft without an effect rewriting the form.
export const ModuleEditDialog = (props: Props) => props.item
    ? <ModuleEditForm key={props.item.id} {...props} item={props.item} /> : null;

const ModuleEditForm = ({ item, disabled, error, onCancel, onConfirm }: Omit<Props, 'item'> & { item: InventoryItem }) => {
    useLang();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const [draft, setDraft] = useState<Draft>(() => readDraft(item));
    const titleId = useId();
    const descriptionId = useId();
    const validationId = useId();
    const itemId = item.id;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!itemId || !dialog) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (!dialog.open) dialog.showModal();
        cancelRef.current?.focus();
        return () => {
            if (dialog.open) dialog.close();
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [itemId]);

    const stats: Stats = { Performance: Number(draft.Performance), Quality: Number(draft.Quality), Efficiency: Number(draft.Efficiency) };
    const validField = (stat: keyof Stats) => draft[stat].trim() !== '' && Number.isSafeInteger(stats[stat])
        && stats[stat] >= MIN_MODULE_STAT && stats[stat] <= MAX_MODULE_STAT;
    const valid = STATS.every(validField) && validateModuleStats(stats);
    const canSave = valid && !disabled;
    const effects = item.effects.flatMap((effect, index) => effect === 'None' ? [] : [
        effect === 'Learning Algorithm' || effect === 'Degrading'
            ? t('{effect} ({v}%)', { effect: t(effect), v: item.effectValues[index] }) : t(effect),
    ]);
    return createPortal(
        <>
            <style>{`.module-edit-dialog::backdrop { background: rgba(0, 0, 0, 0.75); }`}</style>
            <dialog ref={dialogRef} className="module-edit-dialog" role="dialog" aria-modal="true"
                aria-labelledby={titleId} aria-describedby={descriptionId}
                onCancel={event => { event.preventDefault(); onCancel(); }}
                onClick={event => {
                    if (event.target !== event.currentTarget) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel();
                }}
                style={{ width: '460px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)',
                    margin: 'auto', padding: '20px', overflowY: 'auto', background: '#1a1a1a', color: '#eee',
                    border: '1px solid #555', borderRadius: '10px', boxShadow: '0 16px 60px #0009' }}>
                <form noValidate onSubmit={event => { event.preventDefault(); if (canSave) onConfirm(item.id, stats); }}>
                    <h2 id={titleId} style={{ fontSize: '1.15em', lineHeight: 1.4, margin: '0 0 12px' }}>{t('Edit module stats')}</h2>
                    <p id={descriptionId} style={{ color: '#bbb', fontSize: '0.85em', lineHeight: 1.5, marginBottom: '12px' }}>
                        {t("Enter the module's current in-game percentages after its own effects. Exclude machine, neighbor and placement bonuses.")}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, padding: '12px', border: '1px solid #333', borderRadius: '6px' }}>
                        <div aria-hidden="true" style={{ flexShrink: 0 }}><MiniShape shape={item.shape} colorHex={COLOR_MAP[item.color]} size="10px" /></div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: COLOR_MAP[item.color], fontWeight: 600, overflowWrap: 'anywhere' }}>{moduleName(item.displayName)}</div>
                            {effects.length > 0 && <div style={{ color: '#aaa', fontSize: '0.8em', marginTop: '4px' }}>{effects.join(t(', '))}</div>}
                            {item.uid !== undefined && <div style={{ fontSize: '0.8em', color: '#888', marginTop: '4px' }}>{t('Module ID: {id}', { id: item.uid })}</div>}
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', margin: '16px 0 8px' }}>
                        {STATS.map(stat => (
                            <label key={stat} style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px', color: '#bbb', fontSize: '0.8em' }}>
                                <span>{t(stat)} (%)</span>
                                <input type="number" step={1} min={MIN_MODULE_STAT} max={MAX_MODULE_STAT} disabled={disabled}
                                    value={draft[stat]} aria-invalid={!validField(stat)} aria-describedby={!validField(stat) ? validationId : undefined}
                                    onChange={event => setDraft(previous => ({ ...previous, [stat]: event.target.value }))}
                                    style={{ minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '7px 6px', font: 'inherit', color: '#eee', background: '#111',
                                        border: `1px solid ${validField(stat) ? '#555' : '#e2603f'}`, borderRadius: '4px' }} />
                            </label>
                        ))}
                    </div>
                    {!valid && <p id={validationId} role="alert" style={{ color: '#ff7777', fontSize: '0.8em', lineHeight: 1.4 }}>{t('Enter a whole number from -2048 to 2047 for every stat.')}</p>}
                    <p style={{ color: '#aaa', fontSize: '0.8em', lineHeight: 1.5, marginTop: '12px' }}>{t('Turbo can trigger extra uses on the same day.')}</p>
                    <p style={{ color: '#aaa', fontSize: '0.8em', lineHeight: 1.5, marginTop: '6px' }}>{t('These changes affect only this optimizer. Reimporting a save replaces these readings with the saved values.')}</p>
                    {error && <p role="alert" style={{ color: '#ff7777', fontSize: '0.85em', lineHeight: 1.4, marginTop: '12px' }}>{t(error)}</p>}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', marginTop: '20px' }}>
                        <button ref={cancelRef} type="button" autoFocus onClick={onCancel}
                            style={{ padding: '8px 14px', color: '#eee', background: '#292929', border: '1px solid #555', borderRadius: '5px', cursor: 'pointer' }}>{t('Cancel')}</button>
                        <button type="submit" disabled={!canSave}
                            style={{ padding: '8px 14px', color: '#fff', background: '#305d3c', border: '1px solid #51855f', borderRadius: '5px',
                                cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.5 }}>{t('Save stats')}</button>
                    </div>
                </form>
            </dialog>
        </>, document.body,
    );
};
