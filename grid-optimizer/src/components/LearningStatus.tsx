import type { LearningSummary } from '../learningStatus';
import { moduleName, pathLabel, t, useLang } from '../i18n';

export const LearningStatus = ({ summary }: { summary: LearningSummary }) => {
    useLang();
    const counter = t('Unfinished Learning: placed {placed}/{total} · idle {idle}', {
        placed: summary.placedCount, total: summary.count, idle: summary.idleCount,
    });
    const coverageColor = summary.count === 0 ? '#aaa' : summary.idleCount > 0 || summary.blockedCount > 0 ? '#f0cd8d' : '#b6d9bd';
    return (
        <div data-learning-count={summary.count} data-learning-placed={summary.placedCount} data-learning-idle={summary.idleCount}
            style={{ color: coverageColor, borderTop: '1px solid #ffffff16', paddingTop: '5px' }}>
            {summary.count === 0 ? <span>{counter}</span> : (
                <details>
                    <summary style={{ cursor: 'pointer', width: 'fit-content', maxWidth: '100%' }}>{counter}</summary>
                    <ol style={{
                        maxHeight: '180px', overflowY: 'auto', margin: '6px 0 0', padding: '0 0 0 24px',
                        color: '#ddd', background: '#1118', borderRadius: '4px',
                    }}>
                        {summary.entries.map(entry => (
                            <li key={entry.id} style={{ padding: '5px 8px 5px 0' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '3px 12px' }}>
                                    <span style={{ overflowWrap: 'anywhere' }}>
                                        {moduleName(entry.name)}
                                        {entry.uid !== undefined && <span style={{ marginLeft: '6px', color: '#888' }}>{t('Module ID: {id}', { id: entry.uid })}</span>}
                                    </span>
                                    <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: '#b8c9d8' }}>{entry.current}% / {entry.cap}%</span>
                                    <span style={{ color: entry.machineName ? '#9fd8a9' : '#e0b777', overflowWrap: 'anywhere' }}>
                                        {entry.machineName ? t('In machine: {machine}', { machine: pathLabel(entry.machineName) }) : t('Warehouse')}
                                    </span>
                                    {entry.canTrainLearning === false && <span style={{ color: '#f0cd8d' }}>{t('This machine does not trigger Learning.')}</span>}
                                </div>
                            </li>
                        ))}
                    </ol>
                </details>
            )}
            {summary.blockedCount > 0 && <div style={{ color: '#f0cd8d', marginTop: '2px' }}>{t('Placed in non-training machines: {n}', { n: summary.blockedCount })}</div>}
            <div style={{ fontSize: '0.9em', color: '#999', marginTop: '2px' }}>{t('Learns when its machine is used; placement is not proof of a gain.')}</div>
        </div>
    );
};
