import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InventoryItem } from '../types';
import { COLOR_MAP } from '../constants';
import { applyInternalEffects } from '../utils';
import { moduleName, pathLabel, t, useLang } from '../i18n';
import MiniShape from './MiniShape';
import { StatPercentages } from './StatPercentages';

type Props = {
    item: InventoryItem | null;
    onCancel: () => void;
    onConfirm: (id: string) => void;
    disabled: boolean;
    error?: string | null;
};

export const ModuleRemovalDialog = ({ item, onCancel, onConfirm, disabled, error }: Props) => {
    useLang();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const [stage, setStage] = useState<1 | 2>(1);
    const [acknowledged, setAcknowledged] = useState(false);
    const titleId = useId();
    const descriptionId = useId();
    const itemId = item?.id;
    const blocked = disabled || Boolean(error);
    const canProceed = !blocked && (stage === 1 || acknowledged);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!itemId || !dialog) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setStage(1);
        setAcknowledged(false);
        if (!dialog.open) dialog.showModal();
        cancelRef.current?.focus();
        return () => {
            if (dialog.open) dialog.close();
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, [itemId]);

    useEffect(() => { cancelRef.current?.focus(); }, [stage]);

    if (!item) return null;
    const effects = item.effects.flatMap((effect, index) => effect === 'None' ? [] : [
        effect === 'Learning Algorithm' || effect === 'Degrading'
            ? t('{effect} ({v}%)', { effect: t(effect), v: item.effectValues[index] }) : t(effect),
    ]);
    return createPortal(
        <>
            <style>{`.module-removal-dialog::backdrop { background: rgba(0, 0, 0, 0.75); }`}</style>
            <dialog ref={dialogRef} className="module-removal-dialog" role="dialog" aria-modal="true"
                aria-labelledby={titleId} aria-describedby={descriptionId}
                onCancel={event => { event.preventDefault(); onCancel(); }}
                onClick={event => {
                    if (event.target !== event.currentTarget) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onCancel();
                }}
                style={{
                    width: '460px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100dvh - 32px)',
                    margin: 'auto', padding: '20px', overflowY: 'auto',
                    background: '#1a1a1a', color: '#eee', border: '1px solid #555', borderRadius: '10px',
                    boxShadow: '0 16px 60px #0009',
                }}>
                <h2 id={titleId} style={{ fontSize: '1.15em', lineHeight: 1.4, margin: '0 0 12px' }}>
                    {t(stage === 1 ? 'Delete module from optimizer?' : 'Final confirmation')}
                </h2>
                <p id={descriptionId} style={{ color: '#bbb', fontSize: '0.9em', lineHeight: 1.5, marginBottom: '16px' }}>
                    {t('This only removes it from this optimizer. Your game save is unchanged. Reimporting the save restores imported modules.')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid #333', borderRadius: '6px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <div aria-hidden="true" style={{ flexShrink: 0 }}><MiniShape shape={item.shape} colorHex={COLOR_MAP[item.color]} size="10px" /></div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: COLOR_MAP[item.color], fontWeight: 600, overflowWrap: 'anywhere' }}>{moduleName(item.displayName)}</div>
                            {effects.length > 0 && <div style={{ color: '#aaa', fontSize: '0.8em', marginTop: '4px' }}>{effects.join(t(', '))}</div>}
                        </div>
                    </div>
                    <StatPercentages totals={applyInternalEffects(item)} />
                    {item.uid !== undefined && <div style={{ fontSize: '0.8em', color: '#aaa' }}>{t('Module ID: {id}', { id: item.uid })}</div>}
                    {(item.originalPath || item.uid === undefined) && <div style={{ fontSize: '0.8em', color: '#aaa', overflowWrap: 'anywhere' }}>
                        {item.originalPath ? <>{t('Path: ')}{pathLabel(item.originalPath)}</> : t('Added here, not in your save')}
                    </div>}
                </div>
                {stage === 2 && <p style={{ marginTop: '16px', lineHeight: 1.5, fontWeight: 600 }}>{t('Delete this module from the optimizer now?')}</p>}
                {stage === 2 && <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '12px', fontSize: '0.9em', lineHeight: 1.5 }}>
                    <input type="checkbox" checked={acknowledged} disabled={blocked} onChange={event => setAcknowledged(event.target.checked)}
                        style={{ marginTop: '4px', flexShrink: 0 }} />
                    <span>{t('I checked the module details and want to delete it.')}</span>
                </label>}
                {error && <p role="alert" style={{ color: '#ff7777', fontSize: '0.9em', lineHeight: 1.4, marginTop: '12px' }}>{t(error)}</p>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', marginTop: '20px' }}>
                    <button ref={cancelRef} type="button" autoFocus onClick={onCancel}
                        style={{ padding: '8px 14px', color: '#eee', background: '#292929', border: '1px solid #555', borderRadius: '5px', cursor: 'pointer' }}>
                        {t('Cancel')}
                    </button>
                    <button type="button" disabled={!canProceed} onClick={() => {
                        if (!canProceed) return;
                        if (stage === 1) { setAcknowledged(false); setStage(2); }
                        else onConfirm(item.id);
                    }} style={{
                        padding: '8px 14px', color: '#fff', background: stage === 2 ? '#9e3030' : '#305d3c',
                        border: `1px solid ${stage === 2 ? '#c35555' : '#51855f'}`, borderRadius: '5px',
                        cursor: canProceed ? 'pointer' : 'not-allowed', opacity: canProceed ? 1 : 0.5,
                    }}>
                        {t(stage === 1 ? 'Continue' : 'Delete module')}
                    </button>
                </div>
            </dialog>
        </>,
        document.body,
    );
};
