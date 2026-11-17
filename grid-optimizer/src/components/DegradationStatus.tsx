import { useMemo, useState } from 'react';
import type { InventoryItem, Stats, TargetStats } from '../types';
import { calculateBoardStats, indexInventoryById } from '../hooks/useOptimizer';
import { degradationLifetime, firstThresholdFailure, projectDegradation } from '../degradation';
import { desequencerSpeed, isDesequencer, isMirage, miragePointsFor, statName, statUnit, sumsPE } from '../machineDefaults';
import { t, useLang } from '../i18n';
import { evaluateTaskDrop } from '../taskSafety';
import type { TaskSafety } from '../taskSafety';

type Props = {
    machineType: string;
    board: (InventoryItem | 'Locked' | null)[][];
    inventory: InventoryItem[];
    targets: TargetStats;
    ignored: Partial<Record<keyof Stats, boolean>>;
    days: number;
    automaticDays: number;
    override: number | null;
    setOverride: (days: number | null) => void;
    disabled: boolean;
    solver: string;
    statProtectionUses?: Partial<Stats>;
    task?: TaskSafety | null;
    importedDay?: number | null;
};

export const DegradationStatus = ({ machineType, board, inventory, targets, ignored, days, automaticDays, override, setOverride, disabled, solver,
    statProtectionUses, task, importedDay }: Props) => {
    useLang();
    const [draft, setDraft] = useState<string | null>(null);
    const forecast = useMemo(() => {
        const inventoryById = indexInventoryById(inventory);
        const placed = new Map<string, InventoryItem>();
        board.flat().forEach(cell => {
            if (cell && cell !== 'Locked') placed.set(cell.id, inventoryById.get(cell.id) ?? cell);
        });
        const pieces = [...placed.values()];
        const hasDegradation = pieces.some(item => item.effects.includes('Degrading'));
        const lifetime = degradationLifetime(pieces);
        const cache = new Map<number, Stats>();
        const at = (uses: number) => {
            let totals = cache.get(uses);
            if (!totals) {
                const projected = pieces.map(item => projectDegradation(item, uses));
                totals = calculateBoardStats(board, projected, indexInventoryById(projected)).totals;
                cache.set(uses, totals);
            }
            return totals;
        };
        const value = (totals: Stats, stat: keyof Stats) => stat === 'Performance' && isMirage(machineType)
            ? totals.Performance + 2 * totals.Quality
            : stat === 'Efficiency' && sumsPE(machineType) ? totals.Efficiency + totals.Performance : totals[stat];
        const risks = (Object.keys(targets) as (keyof Stats)[])
            .filter(stat => targets[stat] !== null && !ignored[stat] && !(isMirage(machineType) && stat === 'Quality'))
            .map(stat => ({
                stat,
                target: targets[stat]!,
                first: firstThresholdFailure(uses => value(at(uses), stat), targets[stat]!, lifetime),
            }));
        return { hasDegradation, risks };
    }, [board, inventory, machineType, targets, ignored]);

    const hasTargets = forecast.risks.length > 0;
    const phaseAware = Boolean(task || statProtectionUses);
    const risks = forecast.risks.map(risk => {
        const cutoff = statProtectionUses?.[risk.stat] ?? days;
        const unsafe = risk.first !== null && risk.first <= cutoff;
        const actualTaskRisk = task ? evaluateTaskDrop(risk.first, task, risk.stat) : null;
        const afterTask = phaseAware && !unsafe && (task ? actualTaskRisk!.safeAfterCompletion : true);
        return { ...risk, unsafe, afterTask, warning: afterTask && risk.first === 1, actualTaskRisk };
    });
    const unsafe = risks.some(risk => risk.unsafe);
    const warning = risks.some(risk => risk.warning);
    const snapshotDay = task?.importedDay ?? importedDay ?? null;
    const extendsTask = task?.remainingDays !== null && task?.remainingDays !== undefined && days > task.remainingDays;
    const inputInvalid = draft !== null && draft !== '' && (!Number.isInteger(Number(draft)) || Number(draft) < 1 || Number(draft) > 365);
    const threshold = (stat: keyof Stats, target: number) => {
        if (stat === 'Performance' && isDesequencer(machineType)) return `${desequencerSpeed(target)}${t('/day')}`;
        if (stat === 'Performance' && isMirage(machineType)) return t('{n} pts', { n: miragePointsFor(target) });
        const unit = statUnit(machineType, stat);
        return unit ? `${unit.fromPercent(target)} ${unit.unit}` : `${target}%`;
    };
    return (
        <div data-degradation-status="true" style={{ width: '100%', minWidth: 0, overflowWrap: 'anywhere',
            fontSize: '0.72em', lineHeight: 1.4, color: '#aaa', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '4px 6px', flexWrap: 'wrap' }}>
                {t('Degradation protection')}
                <input type="number" min={1} max={365} step={1} disabled={disabled}
                    aria-label={t('Protection days')}
                    placeholder={t('Auto: {d}d', { d: automaticDays })}
                    value={draft ?? override ?? ''}
                    aria-invalid={inputInvalid || undefined}
                    onChange={event => {
                        const text = event.target.value;
                        setDraft(text);
                        if (text === '') setOverride(null);
                        else if (Number.isInteger(Number(text)) && Number(text) >= 1 && Number(text) <= 365) setOverride(Number(text));
                    }}
                    onBlur={() => setDraft(null)}
                    style={{ width: '70px', flex: '0 0 70px', boxSizing: 'border-box', padding: '3px 5px', color: '#eee', background: '#111', border: `1px solid ${inputInvalid ? '#ff7070' : '#444'}`, borderRadius: '4px' }} />
                <span>{t('Protect targets for {d}d', { d: days })}</span>
            </label>
            {extendsTask && <span>{t('The selected protection window extends beyond this task.')}</span>}
            {solver !== 'bloom' && hasTargets && <span>{t('Target protection uses the Bloom solver.')}</span>}
            {hasTargets && (
                <div role="status" style={{ color: unsafe ? '#ff7070' : warning ? '#e0a13a' : '#9fd8a9' }}>
                    {unsafe ? t('Protection not met: a target falls below its threshold within {d}d.', { d: days })
                        : warning ? t('This task can finish; check modules before the next use.')
                        : phaseAware ? t('Targets meet the {d}d task protection requirement.', { d: days })
                        : t('Targets safe through {d}d of degradation.', { d: days })}
                </div>
            )}
            {forecast.hasDegradation && risks.map(risk => (
                <div key={risk.stat} data-degradation-stat={risk.stat} style={{ minWidth: 0,
                    display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px 0',
                    color: risk.unsafe ? '#ff7070' : risk.warning ? '#e0a13a' : '#aaa' }}>
                    <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 6px', alignItems: 'baseline' }}>
                        <span style={{ fontWeight: 600 }}>{statName(machineType, risk.stat)}:</span>
                        <span>{risk.first === 0 ? t('Already below target')
                            : risk.first === null ? t('Stays within target after degradation')
                            : t('Below target after {d}d', { d: risk.first })}</span>
                        {risk.first !== null && snapshotDay !== null && <span>{t('Day {d}', { d: snapshotDay + risk.first })}</span>}
                    </div>
                    <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 6px' }}>
                        <span>{t('Threshold: {value}', { value: threshold(risk.stat, risk.target) })}</span>
                        {risk.warning && <span>{t('Check before the next use.')}</span>}
                        {risk.afterTask && !risk.warning && risk.first !== null && <span>{t('This task finishes before this drop.')}</span>}
                        {risk.unsafe && risk.actualTaskRisk?.safeAfterCompletion
                            && <span>{t('This task can finish; the extra protection requirement is unmet.')}</span>}
                    </div>
                </div>
            ))}
            <details style={{ minWidth: 0 }}>
                <summary style={{ width: 'fit-content', maxWidth: '100%', cursor: 'pointer' }}>{t('Forecast assumptions')}</summary>
                <div style={{ minWidth: 0, marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span>{t('One degradation use per day; no future Learning gains counted. Auto stats may fall.')}</span>
                    {phaseAware && <span>{t('Each target is checked when this task uses that stat.')}</span>}
                </div>
            </details>
        </div>
    );
};
