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
export const createProgressClock = ({ warmupMs = 90_000, idleMs = 60_000 }: ProgressClockOptions = {}) => {
    let context: string | null = null;
    let best: number[] = [];
    let startedAt = 0;
    let progressAt = 0;
    const clear = () => { context = null; best = []; startedAt = 0; progressAt = 0; };
    return {
        observe: (contextKey: string, score: readonly number[], now: number) => {
            // No active numeric goals means there is no optimization to time.
            if (!contextKey || score.length === 0) { clear(); return; }
            if (!Number.isFinite(now) || score.some(value => !Number.isFinite(value))) return;
            if (context !== contextKey || best.length !== score.length || now < startedAt) {
                context = contextKey;
                best = [...score];
                startedAt = now;
                progressAt = now;
            } else if (compare(score, best) > 0) {
                best = [...score];
                progressAt = now;
            }
        },
        clear,
        isStable: (now: number) => context !== null && now - startedAt >= warmupMs && now - progressAt >= idleMs,
        getIdleMs: (now: number) => context === null ? 0 : Math.max(0, now - progressAt),
    };
};
