import type { MachineConfig } from './hooks/useOptimizer';
import type { Stats } from './types';

export type ProgressMachine = {
    id: string;
    config: MachineConfig;
    // Full board totals, including neighbours and placement effects.
    current: Stats;
    future?: Stats;
};

const STATS = ['Performance', 'Quality', 'Efficiency'] as const;
type Stat = typeof STATS[number];

const folded = (config: MachineConfig, stat: Stat) =>
    (stat === 'Quality' && (config.sumPQ || (config.water && config.targetStats.Quality === null)))
    || (stat === 'Performance' && config.sumPE);
const enabled = (config: MachineConfig, stat: Stat) => !config.ignoreStats?.[stat] && !folded(config, stat);
const rank = (config: MachineConfig, stat: Stat) => config.statPriority?.[stat] ?? 1;

const waterMultiplier = (quality: number) => quality >= 150 ? 2 : quality >= 100 ? 1.5
    : quality >= 50 ? 1 : quality >= 0 ? 0.67 : quality >= -50 ? 0.25 : 0.1;
const reading = (config: MachineConfig, totals: Stats, stat: Stat) => {
    const performance = Math.min(totals.Performance, config.performanceCap ?? Infinity);
    if (stat === 'Performance' && config.water) {
        const quality = config.targetStats.Quality === null ? totals.Quality : Math.min(totals.Quality, config.targetStats.Quality);
        return Math.max(0, 100 + performance) * waterMultiplier(quality);
    }
    if (stat === 'Performance' && config.sumPQ) return performance + 2 * totals.Quality;
    if (stat === 'Efficiency' && config.sumPE) return totals.Efficiency + totals.Performance;
    if (stat === 'Performance') return performance;
    if (stat === 'Quality') return Math.min(totals.Quality, config.qualityCap ?? Infinity);
    return totals.Efficiency;
};
const targetReading = (machine: ProgressMachine, stat: Stat) => {
    const today = reading(machine.config, machine.current, stat);
    return (machine.config.degradationDays ?? 0) > 0 && machine.future
        ? Math.min(today, reading(machine.config, machine.future, stat)) : today;
};
const autoWorth = (config: MachineConfig, value: number, stat: Stat) => {
    if (stat !== 'Efficiency') return value;
    const cheapAt = config.cheapEnergyAt;
    const weighted = cheapAt === undefined || value <= cheapAt ? value : cheapAt + (value - cheapAt) * 0.2;
    return weighted * 0.5;
};

/**
 * A common numeric objective for displayed layouts from every solver. Keep user
 * goals fixed rather than taking backend tier arrays: Bloom may ease its Auto
 * stats internally, and the other backends use different tier/tiebreak layouts.
 * Targets precede all Auto values; each group follows the supplied priorities.
 * Piece count, module identities, excess above a target and placement-only
 * tiebreaks are deliberately absent, so reshuffling cannot postpone the hint.
 */
export const progressScore = (machines: readonly ProgressMachine[]): number[] => {
    const ranks = [...new Set(machines.flatMap(({ config }) => STATS.filter(stat => enabled(config, stat)).map(stat => rank(config, stat))))].sort((a, b) => a - b);
    const target = ranks.map(() => 0);
    const auto = ranks.map(() => 0);
    const rankIndex = new Map(ranks.map((value, index) => [value, index]));
    for (const machine of machines) {
        const { config, current } = machine;
        for (const stat of STATS) {
            if (!enabled(config, stat)) continue;
            const index = rankIndex.get(rank(config, stat))!;
            const goal = config.targetStats[stat];
            if (goal !== null) {
                const value = targetReading(machine, stat);
                if (value < goal) {
                    target[index] -= goal - value;
                    // Reaching a preset is meaningful even when a different target
                    // loses the same number of percentage points (Bloom's rule).
                    if (config.targetSteps?.[stat]) target[index] -= 50;
                }
            }
            if (config.maximizeStats[stat]) auto[index] += autoWorth(config, reading(config, current, stat), stat);
        }
    }
    return [...target, ...auto];
};

/** Only explicit targets contribute: Auto improvements never postpone a target stall notice. */
export const progressTargetScore = (machines: readonly ProgressMachine[]): number[] => {
    const ranks = [...new Set(machines.flatMap(({ config }) => STATS
        .filter(stat => enabled(config, stat) && config.targetStats[stat] !== null)
        .map(stat => rank(config, stat))))].sort((a, b) => a - b);
    const score = ranks.map(() => 0);
    const rankIndex = new Map(ranks.map((value, index) => [value, index]));
    for (const machine of machines) {
        for (const stat of STATS) {
            const { config } = machine;
            const goal = config.targetStats[stat];
            if (!enabled(config, stat) || goal === null) continue;
            const value = targetReading(machine, stat);
            if (value < goal) score[rankIndex.get(rank(config, stat))!] -= goal - value + (config.targetSteps?.[stat] ? 50 : 0);
        }
    }
    return score;
};

export const progressTargetSummary = (machines: readonly ProgressMachine[]) => {
    let targetCount = 0, metTargetCount = 0;
    for (const machine of machines) {
        for (const stat of STATS) {
            const goal = machine.config.targetStats[stat];
            if (!enabled(machine.config, stat) || goal === null) continue;
            targetCount++;
            if (targetReading(machine, stat) >= goal) metTargetCount++;
        }
    }
    return { targetCount, metTargetCount, targetsMet: targetCount > 0 && metTargetCount === targetCount };
};

/** Equality at a threshold is safe; ignored/folded targets do not count. */
export const progressTargetsMet = (machines: readonly ProgressMachine[]): boolean => machines.every(machine =>
    STATS.every(stat => !enabled(machine.config, stat) || machine.config.targetStats[stat] === null
        || targetReading(machine, stat) >= machine.config.targetStats[stat]!));

// Integer board stats can still produce fractional water value / energy weights.
// Ignore floating arithmetic noise, while accumulating small real gains against
// the last record rather than against each transient report.
const compare = (score: readonly number[], reference: readonly number[]) => {
    for (let index = 0; index < score.length; index++) {
        const difference = score[index] - reference[index];
        if (Math.abs(difference) > 1e-8) return difference > 0 ? 1 : -1;
    }
    return 0;
};

export type ProgressClockOptions = { warmupMs?: number; idleMs?: number };

/** A hint clock only: it neither controls nor stops a solver. Use a monotonic now. */
export const createProgressClock = ({ warmupMs = 0, idleMs = 60_000 }: ProgressClockOptions = {}) => {
    let context: string | null = null;
    let best: number[] = [];
    let observedAt = 0;
    let progressAt = 0;
    let sessionStartedAt: number | null = null;
    let stoppedAt: number | null = null;
    let quietMs = Number.isFinite(idleMs) ? Math.max(0, idleMs) : 60_000;
    const clearObservation = () => { context = null; best = []; observedAt = 0; progressAt = 0; };
    const clear = () => { clearObservation(); sessionStartedAt = null; stoppedAt = null; };
    return {
        start: (now: number) => {
            clear();
            if (Number.isFinite(now)) sessionStartedAt = now;
        },
        observe: (contextKey: string, score: readonly number[], now: number) => {
            // Losing readiness or all numeric goals invalidates the quiet window,
            // but never erases elapsed time in an ongoing optimization session.
            if (!contextKey || score.length === 0) { clearObservation(); return; }
            if (!Number.isFinite(now) || score.some(value => !Number.isFinite(value))) return;
            if (sessionStartedAt === null || stoppedAt !== null) {
                sessionStartedAt = now;
                stoppedAt = null;
            }
            if (context !== contextKey || best.length !== score.length || now < observedAt) {
                context = contextKey;
                best = [...score];
                observedAt = now;
                progressAt = now;
            } else if (compare(score, best) > 0) {
                best = [...score];
                progressAt = now;
            }
        },
        setIdleMs: (value: number) => { quietMs = Number.isFinite(value) ? Math.max(0, value) : 60_000; },
        stop: (now: number) => {
            if (sessionStartedAt !== null && stoppedAt === null && Number.isFinite(now)) stoppedAt = Math.max(sessionStartedAt, now);
            clearObservation();
        },
        clear,
        isStable: (now: number) => context !== null && now - observedAt >= warmupMs && now - progressAt >= quietMs,
        getIdleMs: (now: number) => context === null ? 0 : Math.max(0, now - progressAt),
        getElapsedMs: (now: number) => sessionStartedAt === null ? 0 : Math.max(0, (stoppedAt ?? now) - sessionStartedAt),
    };
};
