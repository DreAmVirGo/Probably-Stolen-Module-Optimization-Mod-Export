import type { InventoryItem, Stats } from './types';
import { degradationLifetime } from './degradation';
import type { RunningJob } from './runningJobs';
import { desequencerSpeed, statUnit } from './machineDefaults';

type JobKind = RunningJob['kind'];
type Stat = keyof Stats;

export type TaskSafety = {
    kind: JobKind;
    remainingWork: number;
    dailyWork: number;
    // null means this active task cannot advance at the supplied performance.
    remainingDays: number | null;
    // The largest projection index; use statProtectionUses for exact thresholds.
    protectionUses: number;
    statProtectionUses: Stats;
    phase: 'pre-use' | 'post-use-performance' | 'blocked';
    importedDay: number | null;
    completionDay: number | null;
};

const MACHINE_TYPE: Record<JobKind, string> = {
    hydroponic: 'Hydroponic System',
    printer: '3D Printer',
    dna: 'DNA Manipulator',
    desequencer: 'Cryptographic Desequencer',
};
const calendarDay = (day: number | null | undefined) => Number.isSafeInteger(day) && day! >= 0 ? day! : null;

/** Use the existing rounded work/day rules, rather than labels or fresh-job presets. */
export const taskDailyWork = (kind: JobKind, performance: number): number => {
    if (!Number.isFinite(performance)) return 0;
    const speed = kind === 'desequencer' ? desequencerSpeed(performance)
        : statUnit(MACHINE_TYPE[kind], 'Performance')?.fromPercent(performance);
    return speed !== undefined && Number.isFinite(speed) ? Math.max(0, speed) : 0;
};

/** Projection snapshots that can still affect a planned task of this many uses. */
export const statProtectionUsesForDays = (machineType: string, days: number): Stats | null => {
    const name = machineType.toLowerCase();
    const kind: JobKind | null = name === 'printer' || name.includes('3d printer') ? 'printer'
        : name === 'dna' || name.includes('dna manipulator') ? 'dna'
        : name.includes('hydroponic') ? 'hydroponic'
        : name.includes('desequencer') ? 'desequencer' : null;
    if (!kind || !Number.isFinite(days) || days <= 0) return null;
    const uses = Math.max(1, Math.ceil(days));
    return { Performance: kind === 'desequencer' ? uses : uses - 1, Quality: uses - 1, Efficiency: uses - 1 };
};

/**
 * Forecast only the work still in the freshly imported running task. Default
 * machines read snapshot n-1 on use n, while Desequencer Performance reads n.
 * A callback can supply declining full-board Performance at every snapshot;
 * this avoids underestimating duration when Auto Performance falls mid-task.
 */
export const deriveTaskSafety = (job: RunningJob | null | undefined, performance: number | ((uses: number) => number)): TaskSafety | null => {
    if (!job?.active || !(job.kind in MACHINE_TYPE) || !Number.isFinite(job.current) || !Number.isFinite(job.required)
        || job.current < 0 || job.required <= job.current || job.required <= 0) return null;
    const remainingWork = job.required - job.current;
    const at = typeof performance === 'function' ? performance : () => performance;
    let uncompleted = remainingWork;
    let dailyWork = 0;
    let remainingDays: number | null = null;
    for (let night = 1; night <= 365; night++) {
        const snapshot = job.kind === 'desequencer' ? night : night - 1;
        const work = taskDailyWork(job.kind, at(snapshot));
        if (night === 1) dailyWork = work;
        // The supplied forecast only degrades; future Learning is not credited.
        // Once rounded work reaches zero, later snapshots cannot finish the task.
        if (work <= 0) break;
        uncompleted -= work;
        if (uncompleted <= 0) { remainingDays = night; break; }
    }
    const blocked = remainingDays === null;
    const statProtectionUses: Stats = blocked ? { Performance: 365, Quality: 365, Efficiency: 365 }
        : statProtectionUsesForDays(job.kind, remainingDays!)!;
    const importedDay = calendarDay(job.importedDay);
    return {
        kind: job.kind, remainingWork, dailyWork, remainingDays,
        protectionUses: Math.max(...Object.values(statProtectionUses)),
        statProtectionUses,
        phase: blocked ? 'blocked' : job.kind === 'desequencer' ? 'post-use-performance' : 'pre-use',
        importedDay,
        completionDay: importedDay !== null && remainingDays !== null ? importedDay + remainingDays : null,
    };
};

/**
 * Solver horizon for an imported running task after the user unlocks its board.
 * The displayed forecast for the current board is not a safe solve constraint:
 * Auto Performance may change as modules move. An explicit Performance minimum
 * bounds the remaining duration. Without such a bound, protect every target
 * through complete wear of every available module, after which stats are stable.
 * This returns projection indices only, not a promise of task completion.
 */
export const unlockedTaskProtectionUses = (
    job: RunningJob,
    performanceMinimum: number | null,
    inventory: Iterable<InventoryItem>,
): Stats => {
    if (performanceMinimum !== null && Number.isFinite(performanceMinimum)) {
        const bounded = deriveTaskSafety(job, performanceMinimum);
        if (bounded?.remainingDays != null) return bounded.statProtectionUses;
    }
    // Keep the full lifetime, including corrected snapshots and repeated effects;
    // a 365-day simulation ceiling must not truncate a >365-use wear horizon.
    const uses = degradationLifetime(inventory);
    return { Performance: uses, Quality: uses, Efficiency: uses };
};

export type TaskDropRisk = {
    severity: 'safe' | 'warning' | 'unsafe';
    timing: 'none' | 'during-task' | 'next-day' | 'after-completion';
    firstDropDay: number | null;
    safeAfterCompletion: boolean;
};

/**
 * firstDrop is the first projected use whose reading is strictly below a target;
 * equality is safe. A drop after this stat's last task use is an advance warning,
 * including a next-day drop after today's final work, rather than a task failure.
 */
export const evaluateTaskDrop = (firstDrop: number | null, task: TaskSafety, stat: Stat): TaskDropRisk => {
    if (firstDrop === null) return { severity: 'safe', timing: 'none', firstDropDay: null, safeAfterCompletion: false };
    const use = Math.max(0, Math.trunc(firstDrop));
    const firstDropDay = task.importedDay === null ? null : task.importedDay + use;
    const unsafe = use === 0 || task.remainingDays === null || use <= task.statProtectionUses[stat];
    if (unsafe) return { severity: 'unsafe', timing: 'during-task', firstDropDay, safeAfterCompletion: false };
    return {
        severity: use === 1 ? 'warning' : 'safe', timing: use === 1 ? 'next-day' : 'after-completion', firstDropDay,
        safeAfterCompletion: task.remainingDays !== null && use >= task.remainingDays,
    };
};
