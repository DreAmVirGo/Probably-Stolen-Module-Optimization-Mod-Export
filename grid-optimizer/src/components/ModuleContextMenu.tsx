import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { InventoryItem } from '../types';
import { moduleName, t, useLang } from '../i18n';

export const ModuleContextMenu = ({ item, x, y, disabled, reason, onClose, onEdit, onDelete }: {
    item: InventoryItem; x: number; y: number; disabled: boolean; reason: string | null;
    onClose: () => void; onEdit: () => void; onDelete: () => void;
}) => {
    useLang();
    const menu = useRef<HTMLDivElement>(null);
    const close = useRef(onClose);
    useEffect(() => { close.current = onClose; }, [onClose]);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        (menu.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? menu.current)?.focus();
        const outside = (event: MouseEvent) => {
            if (!menu.current?.contains(event.target as Node)) close.current();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); close.current(); }
        };
        const dismiss = () => close.current();
        document.addEventListener('mousedown', outside);
        document.addEventListener('keydown', escape);
        window.addEventListener('resize', dismiss);
        window.addEventListener('scroll', dismiss, true);
        return () => {
            document.removeEventListener('mousedown', outside);
            document.removeEventListener('keydown', escape);
            window.removeEventListener('resize', dismiss);
            window.removeEventListener('scroll', dismiss, true);
            if (previous?.isConnected) previous.focus();
        };
    }, []);
    return createPortal(
        <div ref={menu} role="menu" tabIndex={-1} aria-label={t('Module actions')}
            onKeyDown={event => {
                if (event.key === 'Tab') close.current();
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    const enabled = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? []);
                    if (enabled.length === 0) return;
                    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
                        : current < 0 ? (event.key === 'ArrowDown' ? 0 : enabled.length - 1)
                        : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
                    enabled[next].focus();
                }
            }}
            style={{ position: 'fixed', zIndex: 15000, left: Math.max(8, Math.min(x, window.innerWidth - 248)),
                top: Math.max(8, Math.min(y, window.innerHeight - 190)), width: '232px', maxWidth: 'calc(100vw - 16px)',
                padding: '7px', border: '1px solid #555', borderRadius: '7px', background: '#252526', boxShadow: '0 8px 28px #0008' }}>
            <div style={{ padding: '3px 6px 7px', fontSize: '0.75em', color: '#aaa', overflowWrap: 'anywhere' }}>{moduleName(item.displayName)}</div>
            <button type="button" role="menuitem" disabled={disabled} onClick={onEdit}
                style={{ width: '100%', padding: '8px 6px', marginBottom: '6px', textAlign: 'left', border: '1px solid #3e5e4a', borderRadius: '4px',
                    background: '#25392c', color: disabled ? '#888' : '#a7d7b4', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                {t('Edit stats…')}
            </button>
            <button type="button" role="menuitem" disabled={disabled} onClick={onDelete}
                style={{ width: '100%', padding: '8px 6px', textAlign: 'left', border: '1px solid #5e3434', borderRadius: '4px',
                    background: '#392525', color: disabled ? '#888' : '#ff9292', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                {t('Delete from warehouse…')}
            </button>
            {reason && <div style={{ padding: '6px', fontSize: '0.72em', color: '#aaa' }}>{t(reason)}</div>}
        </div>, document.body,
    );
};
