import { useMemo, useState } from 'react';
import type { InventoryItem, Stats, TargetStats } from '../types';
import { calculateBoardStats, indexInventoryById } from '../hooks/useOptimizer';
import { degradationLifetime, firstThresholdFailure, projectDegradation } from '../degradation';
import { desequencerSpeed, isDesequencer, isMirage, miragePointsFor, statName, statUnit, sumsPE } from '../machineDefaults';
import { t, useLang } from '../i18n';

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
};

export const DegradationStatus = ({ machineType, board, inventory, targets, ignored, days, automaticDays, override, setOverride, disabled, solver }: Props) => {
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
    const unsafe = forecast.risks.some(risk => risk.first !== null && risk.first <= days);
    const inputInvalid = draft !== null && draft !== '' && (!Number.isInteger(Number(draft)) || Number(draft) < 1 || Number(draft) > 365);
    const threshold = (stat: keyof Stats, target: number) => {
        if (stat === 'Performance' && isDesequencer(machineType)) return `${desequencerSpeed(target)}${t('/day')}`;
        if (stat === 'Performance' && isMirage(machineType)) return t('{n} pts', { n: miragePointsFor(target) });
        const unit = statUnit(machineType, stat);
        return unit ? `${unit.fromPercent(target)} ${unit.unit}` : `${target}%`;
    };
    return (
        <div style={{ fontSize: '0.72em', color: '#aaa', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
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
                    style={{ width: '90px', padding: '3px 5px', color: '#eee', background: '#111', border: `1px solid ${inputInvalid ? '#ff7070' : '#444'}`, borderRadius: '4px' }} />
                <span>{t('Protect targets for {d}d', { d: days })}</span>
            </label>
            <span>{t('One degradation use per day; no future Learning gains counted. Auto stats may fall.')}</span>
            {solver !== 'bloom' && hasTargets && <span>{t('Target protection uses the Bloom solver.')}</span>}
            {hasTargets && (
                <div role="status" style={{ color: unsafe ? '#ff7070' : '#9fd8a9' }}>
                    {unsafe ? t('Unsafe: a target fails within {d}d. Optimize again or change the target.', { d: days })
                        : t('Targets safe through {d}d of degradation.', { d: days })}
                </div>
            )}
            {forecast.hasDegradation && forecast.risks.map(risk => (
                <span key={risk.stat} style={{ color: risk.first === null ? '#aaa' : risk.first <= days ? '#ff7070' : '#e0a13a' }}>
                    {statName(machineType, risk.stat)}: {risk.first === 0 ? t('Already below target')
                        : risk.first === null ? t('Stays within target after degradation')
                        : t('Below target after {d}d', { d: risk.first })}
                    {' · '}{threshold(risk.stat, risk.target)}
                </span>
            ))}
        </div>
    );
};
