import type { OptimizationProgress } from '../hooks/useOptimizationProgress';
import type { LearningSummary } from '../learningStatus';
import { plural, t, useLang } from '../i18n';
import { LearningStatus } from './LearningStatus';

const IDLE_OPTIONS = [10, 20, 30, 60, 90];

export const OptimizationNotice = ({ progress, idleThreshold, onIdleThresholdChange, selectedCount, learning }: {
    progress: OptimizationProgress | null;
    idleThreshold: number;
    onIdleThresholdChange: (seconds: number) => void;
    selectedCount: number;
    learning?: LearningSummary | null;
}) => {
    useLang();
    const elapsed = progress?.elapsedSeconds ?? 0;
    const total = progress?.targetCount ?? 0;
    const met = progress?.metTargetCount ?? 0;
    const allMet = total > 0 && met === total;
    const stalled = Boolean(progress?.running && progress.stable);
    const watched = progress?.running ? progress.watchedCount : selectedCount;
    const color = allMet ? '#b6d9bd' : total > 0 ? '#f0cd8d' : '#bdbdbd';
    return (
        <div data-optimization-status="true" style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px',
            border: `1px solid ${allMet ? '#3f6b4a' : total > 0 ? '#886632' : '#393939'}`, borderRadius: '6px',
            background: allMet ? '#1b2b20' : total > 0 ? '#302719' : '#1c1c1c',
            fontSize: '0.8em', lineHeight: 1.5,
            display: 'flex', flexDirection: 'column', gap: '5px',
        }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px' }}>
                <strong data-elapsed-seconds={elapsed} style={{ color: '#eee', fontVariantNumeric: 'tabular-nums' }}>
                    {t('Elapsed: {s}s', { s: elapsed })}
                </strong>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#bbb' }}
                    title={t('Show a hint after this many seconds without a new best on watched machines. This does not stop the optimizer.')}>
                    {t('No-improvement threshold')}
                    <select aria-label={t('No-improvement threshold')} value={idleThreshold}
                        onChange={event => {
                            const seconds = Number(event.target.value);
                            if (IDLE_OPTIONS.includes(seconds)) onIdleThresholdChange(seconds);
                        }}
                        style={{ padding: '2px 5px', border: '1px solid #555', borderRadius: '4px', background: '#111', color: '#eee', font: 'inherit' }}>
                        {IDLE_OPTIONS.map(seconds => <option key={seconds} value={seconds}>{t('{s}s', { s: seconds })}</option>)}
                    </select>
                </label>
                <div role="status" aria-live="polite" style={{ color }}>
                    <strong>{allMet ? t('All targets are met')
                        : total > 0 ? t('Targets met: {met}/{total}', { met, total }) : t('No explicit targets set')}</strong>
                    {allMet && <span style={{ marginLeft: '6px', fontVariantNumeric: 'tabular-nums' }}>{met}/{total}</span>}
                </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 14px', color: '#aaa' }}>
                <span data-watched-count={watched}>
                    {watched === 0 ? t(progress?.running && selectedCount > 0 ? 'No watched machines are running.' : 'No machines selected for improvement hints.')
                        : t(progress?.running ? 'Watching {n} running machine{s}' : 'Watching {n} machine{s}', { n: watched, s: plural(watched) })}
                </span>
                {total > 0 && <span>{t('Target status includes degradation protection.')}</span>}
                {stalled && <span role="status" style={{ color: '#f0cd8d' }}>{t('No new best on watched machines for {s}s.', { s: progress!.idleSeconds })}</span>}
                {progress?.running && <span>{t('The search continues; Auto values may still improve.')}</span>}
                {!progress?.running && <span>{t(elapsed > 0 ? 'Optimization stopped.' : 'Ready to optimize.')}</span>}
            </div>
            {learning && <LearningStatus summary={learning} />}
        </div>
    );
};
