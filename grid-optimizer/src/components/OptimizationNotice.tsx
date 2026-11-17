import type { OptimizationProgress } from '../hooks/useOptimizationProgress';
import { t, useLang } from '../i18n';

export const OptimizationNotice = ({ progress }: { progress: OptimizationProgress | null }) => {
    useLang();
    if (!progress?.stable) return null;
    const met = progress.targetsMet;
    return (
        <div style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px',
            border: `1px solid ${met ? '#3f6b4a' : '#886632'}`, borderRadius: '6px',
            background: met ? '#1b2b20' : '#302719', color: met ? '#b6d9bd' : '#f0cd8d',
            fontSize: '0.82em', lineHeight: 1.5,
        }}>
            <div role="status" aria-live="polite">
                <strong>{t(met ? 'Optimization is roughly stable' : 'Search has stalled')}</strong>
                <div>{t(met ? 'All explicit targets on running machines are met, including degradation protection.'
                    : 'Some explicit targets on running machines remain unmet. Review the highlighted targets before stopping.')}</div>
            </div>
            <div style={{ color: '#bdbdbd' }}>{t('No improvement in the evaluated goals for {s}s. You can continue optimizing or stop when satisfied.', { s: progress.idleSeconds })}</div>
        </div>
    );
};
