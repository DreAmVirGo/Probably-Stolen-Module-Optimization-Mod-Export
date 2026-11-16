import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { InventoryItem } from '../types';
import { moduleName, t, useLang } from '../i18n';

export const ModuleContextMenu = ({ item, x, y, disabled, reason, onClose, onDelete }: {
    item: InventoryItem; x: number; y: number; disabled: boolean; reason: string | null;
    onClose: () => void; onDelete: () => void;
}) => {
    useLang();
    const menu = useRef<HTMLDivElement>(null);
    const action = useRef<HTMLButtonElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        (action.current?.disabled ? menu.current : action.current)?.focus();
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
                    action.current?.focus();
                }
            }}
            style={{ position: 'fixed', zIndex: 15000, left: Math.max(8, Math.min(x, window.innerWidth - 248)),
                top: Math.max(8, Math.min(y, window.innerHeight - 140)), width: '232px', maxWidth: 'calc(100vw - 16px)',
                padding: '7px', border: '1px solid #555', borderRadius: '7px', background: '#252526', boxShadow: '0 8px 28px #0008' }}>
            <div style={{ padding: '3px 6px 7px', fontSize: '0.75em', color: '#aaa', overflowWrap: 'anywhere' }}>{moduleName(item.displayName)}</div>
            <button ref={action} type="button" role="menuitem" disabled={disabled} onClick={onDelete}
                style={{ width: '100%', padding: '8px 6px', textAlign: 'left', border: '1px solid #5e3434', borderRadius: '4px',
                    background: '#392525', color: disabled ? '#888' : '#ff9292', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                {t('Delete from warehouse…')}
            </button>
            {reason && <div style={{ padding: '6px', fontSize: '0.72em', color: '#aaa' }}>{t(reason)}</div>}
        </div>, document.body,
    );
};
