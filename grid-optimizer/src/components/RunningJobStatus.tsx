import type { RunningJob } from '../runningJobs';
import type { TaskSafety } from '../taskSafety';
import { t, useLang } from '../i18n';

export const RunningJobStatus = ({ job, task, autoLocked }: {
    job: RunningJob | null;
    task: TaskSafety | null;
    autoLocked: boolean;
}) => {
    useLang();
    if (!job) return null;
    const snapshotDay = task?.importedDay ?? job.importedDay;
    const blocked = task?.phase === 'blocked';
    return (
        <div data-running-job="true" style={{
            width: '100%', padding: '8px 10px', boxSizing: 'border-box',
            border: `1px solid ${blocked ? '#886632' : '#576378'}`, borderRadius: '6px', background: blocked ? '#302719' : '#202631',
            color: blocked ? '#f0cd8d' : '#c3d4ed', fontSize: '0.73em', lineHeight: 1.5,
            display: 'flex', flexDirection: 'column', gap: '3px',
        }}>
            <strong>{t(autoLocked ? 'Task in progress · automatically locked' : 'Task in progress')}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', fontVariantNumeric: 'tabular-nums' }}>
                <span>{t('Work: {current}/{required}', { current: job.current, required: job.required })}</span>
                {task?.remainingDays !== null && task?.remainingDays !== undefined
                    ? <span>{t('Estimated remaining: {d}d', { d: task.remainingDays })}</span>
                    : <span>{t('Completion cannot be confirmed with the current modules.')}</span>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 12px', color: '#9aa9bd' }}>
                {snapshotDay !== null && <span>{t('Snapshot: day {d}', { d: snapshotDay })}</span>}
                {task?.completionDay !== null && task?.completionDay !== undefined
                    && <span>{t('Estimated completion: day {d}', { d: task.completionDay })}</span>}
            </div>
            <span style={{ color: '#aaa' }}>{t('Reimport after the task finishes; the website does not monitor the live game.')}</span>
        </div>
    );
};
