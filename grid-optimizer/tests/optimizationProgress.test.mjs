import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressClock, progressScore, progressTargetsMet, progressTargetScore, progressTargetSummary, watchedMachineScore } from '../src/optimizationProgress.ts';

const stats = (Performance = 0, Quality = 0, Efficiency = 0) => ({ Performance, Quality, Efficiency });
const machine = (extra = {}, current = stats(), future) => ({
    id: 'm', current, future,
    config: {
        id: 'm', tier: 3,
        targetStats: { Performance: null, Quality: null, Efficiency: null },
        maximizeStats: { Performance: true, Quality: false, Efficiency: false },
        ignoreStats: { Performance: false, Quality: true, Efficiency: true },
        ...extra,
    },
});

test('task target status uses separate stat snapshots and honors a zero-use finishing boundary', () => {
    const configured = machine({
        degradationDays: 2,
        degradationUses: { Performance: 2, Quality: 1, Efficiency: 0 },
        targetStats: { Performance: 10, Quality: 10, Efficiency: 10 },
        ignoreStats: { Performance: false, Quality: false, Efficiency: false },
    }, stats(11, 11, 10), stats(-999, -999, -999));
    configured.futureByStat = {
        Performance: stats(10, 9, 8), Quality: stats(11, 10, 9), Efficiency: stats(11, 11, 9),
    };
    assert.deepEqual(progressTargetSummary([configured]), { targetCount: 3, metTargetCount: 3, targetsMet: true });
    assert.deepEqual(progressTargetScore([configured]), [0]);
    configured.futureByStat.Performance = stats(9, 9, 8);
    assert.deepEqual(progressTargetSummary([configured]), { targetCount: 3, metTargetCount: 2, targetsMet: false });
    assert.deepEqual(progressTargetScore([configured]), [-1]);
    configured.current.Efficiency = 9;
    assert.deepEqual(progressTargetSummary([configured]), { targetCount: 3, metTargetCount: 1, targetsMet: false });
});

test('default hint starts after sixty quiet seconds, without a hidden ninety-second warmup', () => {
    const clock = createProgressClock();
    clock.observe('run1', [0, 10], 0);
    assert.equal(clock.isStable(59_999), false);
    assert.equal(clock.isStable(60_000), true);
    clock.observe('run1', [0, 11], 60_001);
    assert.equal(clock.isStable(60_001), false);
    assert.equal(clock.isStable(120_000), false);
    assert.equal(clock.isStable(120_001), true);
});

test('every dropdown threshold triggers at exactly its selected quiet duration', () => {
    for (const seconds of [10, 20, 30, 60, 90]) {
        const clock = createProgressClock({ idleMs: seconds * 1000 });
        clock.observe('run', [0, 10], 500);
        assert.equal(clock.isStable(500 + seconds * 1000 - 1), false, `${seconds}s just before threshold`);
        assert.equal(clock.isStable(500 + seconds * 1000), true, `${seconds}s threshold`);
    }
});

test('equal scores, worse scores and recovery to an old record do not postpone the hint', () => {
    const clock = createProgressClock();
    clock.observe('run', [0, 10], 0);
    clock.observe('run', [0, 10], 30_000);
    clock.observe('run', [-1, 1_000], 50_000);
    clock.observe('run', [0, 10], 80_000);
    assert.equal(clock.getIdleMs(90_000), 90_000);
    assert.equal(clock.isStable(90_000), true);
});

test('stopping, restarting or changing goals starts a fresh quiet window', () => {
    const clock = createProgressClock();
    clock.observe('first', [0, 10], 0);
    assert.equal(clock.isStable(90_000), true);
    clock.observe('new-goal', [0, 10], 90_001);
    assert.equal(clock.isStable(90_001), false);
    assert.equal(clock.isStable(180_001), true);
    clock.clear();
    assert.equal(clock.isStable(999_999), false);
    assert.equal(clock.getIdleMs(999_999), 0);
    clock.observe('new-goal', [0, 10], 1_000_000);
    assert.equal(clock.isStable(1_000_000), false);
    clock.observe('', [], 1_090_000);
    assert.equal(clock.isStable(1_090_000), false);
});

test('target progress outranks Auto and follows stat priority', () => {
    const extra = {
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
        statPriority: { Performance: 1, Quality: 2, Efficiency: 2 },
    };
    assert.deepEqual(progressScore([machine(extra, stats(15, 30))]), [-5, 0, 0, 30]);
    const clock = createProgressClock();
    clock.observe('run', progressScore([machine(extra, stats(15, 30))]), 0);
    clock.observe('run', progressScore([machine(extra, stats(16, 20))]), 90_000);
    assert.equal(clock.isStable(90_000), false);
});

test('forecast target progress counts when today is unchanged, while Auto uses today', () => {
    const extra = {
        degradationDays: 4,
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    };
    const first = machine(extra, stats(25, 30), stats(16, 10));
    const better = machine(extra, stats(25, 30), stats(18, 5));
    assert.deepEqual(progressScore([first]), [-4, 30]);
    assert.deepEqual(progressScore([better]), [-2, 30]);
    assert.equal(progressTargetsMet([better]), false);
    assert.equal(progressTargetsMet([machine(extra, stats(25, 30), stats(20, 0))]), true);
    assert.equal(progressTargetsMet([machine(extra, stats(19, 30), stats(25, 0))]), false);
    const clock = createProgressClock();
    clock.observe('run', progressScore([first]), 0);
    clock.observe('run', progressScore([better]), 90_000);
    assert.equal(clock.isStable(90_000), false);
});

test('overshoot, ignored stats and identities do not change the numeric objective', () => {
    const extra = {
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false },
    };
    assert.deepEqual(progressScore([machine(extra, stats(20, 10))]), progressScore([{ ...machine(extra, stats(30, 999)), id: 'other-layout' }]));
    assert.equal(progressTargetsMet([machine({ ...extra, ignoreStats: { Performance: true, Quality: true, Efficiency: true } }, stats(-999))]), true);
});

test('Mirage folds P plus twice Q and AgeWell folds P plus E', () => {
    const mirage = machine({
        sumPQ: true,
        targetStats: { Performance: 40, Quality: 999, Efficiency: null },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    }, stats(10, 15));
    assert.deepEqual(progressScore([mirage]), [0, 0]);
    assert.equal(progressTargetsMet([mirage]), true);
    const agewell = machine({
        sumPE: true,
        targetStats: { Performance: 999, Quality: null, Efficiency: 25 },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false },
        ignoreStats: { Performance: false, Quality: true, Efficiency: false },
    }, stats(10, 0, 15));
    assert.deepEqual(progressScore([agewell]), [0, 0]);
    assert.equal(progressTargetsMet([agewell]), true);
});

test('water output, caps and energy soft cap follow the displayed machine objectives', () => {
    const farm = machine({
        water: true, performanceCap: 500,
        maximizeStats: { Performance: true, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    }, stats(700, 150));
    assert.deepEqual(progressScore([farm]), [0, 1200]);
    const capped = machine({
        qualityCap: 100, cheapEnergyAt: 50,
        maximizeStats: { Performance: false, Quality: true, Efficiency: true },
        ignoreStats: { Performance: true, Quality: false, Efficiency: false },
    }, stats(0, 150, 100));
    assert.deepEqual(progressScore([capped]), [0, 130]);
});

test('empty score clears the clock, and invalid samples cannot manufacture progress', () => {
    const clock = createProgressClock();
    clock.observe('run', [0, 10], 0);
    clock.observe('run', [NaN, 100], 60_000);
    assert.equal(clock.isStable(90_000), true);
    clock.observe('run', [], 90_001);
    assert.equal(clock.isStable(90_001), false);
    assert.deepEqual(progressScore([]), []);
    assert.equal(progressTargetsMet([]), true);
});


test('changing the idle dropdown preserves both elapsed time and the last improvement timestamp', () => {
    const clock = createProgressClock();
    clock.start(1_000);
    clock.observe('run', [10], 1_000);
    clock.observe('run', [11], 6_000);
    assert.equal(clock.getElapsedMs(16_000), 15_000);
    assert.equal(clock.getIdleMs(16_000), 10_000);
    assert.equal(clock.isStable(16_000), false);
    clock.setIdleMs(10_000);
    assert.equal(clock.isStable(16_000), true);
    assert.equal(clock.getElapsedMs(16_000), 15_000);
    assert.equal(clock.getIdleMs(16_000), 10_000);
    clock.setIdleMs(90_000);
    assert.equal(clock.isStable(16_000), false);
    assert.equal(clock.getElapsedMs(96_000), 95_000);
    assert.equal(clock.isStable(96_000), true);
});

test('goal changes reset the quiet window while a stopped run keeps its elapsed duration', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(10_000);
    clock.observe('goalA', [10], 10_000);
    clock.observe('goalB', [5], 25_000);
    assert.equal(clock.getElapsedMs(25_000), 15_000);
    assert.equal(clock.getIdleMs(25_000), 0);
    assert.equal(clock.isStable(34_999), false);
    assert.equal(clock.isStable(35_000), true);
    clock.stop(37_500);
    assert.equal(clock.getElapsedMs(90_000), 27_500);
    assert.equal(clock.getIdleMs(90_000), 0);
    assert.equal(clock.isStable(90_000), false);
    // Repeated stopped snapshots must not lengthen the finished duration.
    clock.stop(100_000);
    assert.equal(clock.getElapsedMs(200_000), 27_500);
    clock.start(200_000);
    clock.observe('goalB', [5], 200_000);
    assert.equal(clock.getElapsedMs(202_000), 2_000);
    assert.equal(clock.isStable(202_000), false);
});

test('temporary missing snapshots clear stagnation but do not erase an ongoing session duration', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    clock.observe('run', [5], 0);
    clock.observe('', [], 15_000);
    assert.equal(clock.getElapsedMs(20_000), 20_000);
    assert.equal(clock.isStable(20_000), false);
    clock.observe('run', [5], 20_000);
    assert.equal(clock.isStable(29_999), false);
    assert.equal(clock.isStable(30_000), true);
    assert.equal(clock.getElapsedMs(30_000), 30_000);
});

test('Auto gains cannot postpone an explicit-target stall, including Max plus Target stats', () => {
    const config = {
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: true, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    };
    const first = machine(config, stats(15, 10));
    const autoBetter = machine(config, stats(15, 999));
    assert.deepEqual(progressTargetScore([first]), [-5]);
    assert.deepEqual(progressTargetScore([autoBetter]), [-5]);
    assert.notDeepEqual(progressScore([first]), progressScore([autoBetter]));
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observe('run', progressTargetScore([first]), 0);
    clock.observe('run', progressTargetScore([autoBetter]), 9_999);
    assert.equal(clock.isStable(10_000), true);
    clock.observe('run', progressTargetScore([machine(config, stats(16, 999))]), 10_001);
    assert.equal(clock.isStable(10_001), false);
    assert.deepEqual(progressTargetScore([machine(config, stats(20, 1))]), [0]);
    assert.deepEqual(progressTargetScore([machine(config, stats(50, 999))]), [0]);
});

test('target summary counts explicit all-page goals and protected future failures independently of Auto', () => {
    const configured = {
        degradationDays: 4,
        targetStats: { Performance: 20, Quality: 30, Efficiency: null },
        maximizeStats: { Performance: false, Quality: false, Efficiency: true },
        ignoreStats: { Performance: false, Quality: false, Efficiency: false },
    };
    const working = machine(configured, stats(20, 30), stats(20, 30));
    const idleUnmet = { ...machine(configured, stats(25, 35), stats(19, 30)), id: 'not-running' };
    assert.deepEqual(progressTargetSummary([working]), { targetCount: 2, metTargetCount: 2, targetsMet: true });
    assert.deepEqual(progressTargetSummary([working, idleUnmet]), { targetCount: 4, metTargetCount: 3, targetsMet: false });
    assert.deepEqual(progressTargetScore([idleUnmet]), [-1]);
    assert.deepEqual(progressTargetSummary([machine()]), { targetCount: 0, metTargetCount: 0, targetsMet: false });
    assert.deepEqual(progressTargetSummary([]), { targetCount: 0, metTargetCount: 0, targetsMet: false });
    assert.deepEqual(progressTargetScore([machine()]), []);
});

test('target-only score and counts respect folded or ignored goals and fixed target priority', () => {
    const folded = machine({
        sumPQ: true,
        targetStats: { Performance: 40, Quality: 999, Efficiency: 999 },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    }, stats(10, 15));
    assert.deepEqual(progressTargetSummary([folded]), { targetCount: 1, metTargetCount: 1, targetsMet: true });
    assert.deepEqual(progressTargetScore([folded]), [0]);
    const lower = { ...machine({ targetStats: { Performance: 20, Quality: null, Efficiency: null }, statPriority: { Performance: 2 } }, stats(15)), id: 'lower' };
    const higher = machine({ targetStats: { Performance: 20, Quality: null, Efficiency: null }, statPriority: { Performance: 1 } }, stats(18));
    assert.deepEqual(progressTargetScore([lower, higher]), [-2, -5]);
});


test('legacy aggregate target scores include stopped goals even when running machines are Auto', () => {
    const stopped = { ...machine({ targetStats: { Performance: 20, Quality: null, Efficiency: null } }, stats(19)), id: 'stopped-goal' };
    const activeAuto = machine({}, stats(10));
    const autoBetter = machine({}, stats(999));
    assert.deepEqual(progressTargetScore([activeAuto]), []);
    assert.deepEqual(progressTargetScore([activeAuto, stopped]), [-1]);
    assert.deepEqual(progressTargetScore([autoBetter, stopped]), [-1]);
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observe('page-goals', progressTargetScore([activeAuto, stopped]), 0);
    clock.observe('page-goals', progressTargetScore([autoBetter, stopped]), 9_999);
    assert.equal(clock.isStable(10_000), true);
    assert.deepEqual(progressTargetSummary([autoBetter, stopped]), { targetCount: 1, metTargetCount: 0, targetsMet: false });
});


const namedMachine = (id, extra = {}, current = stats(), future) => {
    const value = machine(extra, current, future);
    return { ...value, id, config: { ...value.config, id } };
};

test('watched scores contain Auto and Max only, with global target readiness handled separately', () => {
    const targeted = {
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    };
    assert.deepEqual(watchedMachineScore(machine(targeted, stats(15, 10))), [10]);
    assert.deepEqual(watchedMachineScore(machine(targeted, stats(19, 999))), [999]);
    assert.deepEqual(watchedMachineScore(machine(targeted, stats(20, 10))), [10]);
    assert.deepEqual(watchedMachineScore(machine(targeted, stats(25, 10))), [10]);
    assert.deepEqual(watchedMachineScore(machine(targeted, stats(25, 11))), [11]);
    assert.deepEqual(watchedMachineScore(machine({ ...targeted, maximizeStats: { ...targeted.maximizeStats, Performance: true } }, stats(25, 11))), [36]);
    const targetOnly = { ...targeted, maximizeStats: { Performance: false, Quality: false, Efficiency: false } };
    assert.deepEqual(watchedMachineScore(machine(targetOnly, stats(20, 100))), []);
    assert.deepEqual(watchedMachineScore(machine(targetOnly, stats(999, 100))), []);
    assert.deepEqual(watchedMachineScore(machine({}, stats(10))), [10]);
});


test('any watched machine new record postpones the hint even when another card loses more', () => {
    const target = {
        targetStats: { Performance: 100, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    };
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observeMachines('watched-goals', [namedMachine('A', target, stats(100, 95)), namedMachine('B', target, stats(100, 95))], 0);
    clock.observeMachines('watched-goals', [namedMachine('A', target, stats(100, 96)), namedMachine('B', target, stats(100, 0))], 9_000);
    assert.equal(clock.getIdleMs(10_000), 1_000);
    assert.equal(clock.isStable(10_000), false);
    clock.observeMachines('watched-goals', [namedMachine('A', target, stats(100, 96)), namedMachine('B', target, stats(100, 95))], 18_000);
    assert.equal(clock.isStable(19_000), true, 'B merely recovered its previous best');
    clock.observeMachines('watched-goals', [namedMachine('A', target, stats(100, 0)), namedMachine('B', target, stats(100, 96))], 19_001);
    assert.equal(clock.isStable(19_001), false, 'B earned its own new record despite A losing progress');
});

test('moving the same layout between watched cards cannot keep resetting progress on recoveries', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observeMachines('same-goals', [namedMachine('A', {}, stats(10)), namedMachine('B', {}, stats(20))], 0);
    clock.observeMachines('same-goals', [namedMachine('A', {}, stats(20)), namedMachine('B', {}, stats(10))], 9_000);
    assert.equal(clock.isStable(10_000), false, 'A first reached a new personal best');
    clock.observeMachines('same-goals', [namedMachine('A', {}, stats(10)), namedMachine('B', {}, stats(20))], 18_000);
    assert.equal(clock.isStable(19_000), true);
    clock.observeMachines('same-goals', [namedMachine('A', {}, stats(20)), namedMachine('B', {}, stats(10))], 27_000);
    assert.equal(clock.isStable(27_000), true, 'neither card surpassed its own best during this run');
    clock.observeMachines('same-goals', [namedMachine('A', {}, stats(21)), namedMachine('B', {}, stats(20))], 28_000);
    assert.equal(clock.isStable(28_000), false);
});

test('an earlier-priority loss is never skipped to credit a later-priority gain', () => {
    const config = {
        maximizeStats: { Performance: true, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
        statPriority: { Performance: 1, Quality: 2 },
    };
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observeMachines('priorities', [machine(config, stats(10, 10))], 0);
    clock.observeMachines('priorities', [machine(config, stats(9, 999))], 9_999);
    assert.equal(clock.isStable(10_000), true);
    clock.observeMachines('priorities', [machine(config, stats(10 + 1e-10, 10))], 10_001);
    assert.equal(clock.isStable(10_001), true, 'positive arithmetic noise is not a new record either');
    clock.observeMachines('priorities', [machine(config, stats(10, 11))], 10_002);
    assert.equal(clock.isStable(10_002), false);
});

test('unwatched and stopped target failures gate every watched Auto clock globally', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    const watched = namedMachine('watched', {}, stats(10));
    const stopped = namedMachine('stopped', { targetStats: { Performance: 20, Quality: null, Efficiency: null } }, stats(19));
    const ready = machines => { const summary = progressTargetSummary(machines); return summary.targetCount === 0 || summary.targetsMet; };
    assert.equal(ready([watched, stopped]), false);
    clock.observeMachines('watch-only-context', [watched], 0, ready([watched, stopped]));
    clock.observeMachines('watch-only-context', [{ ...watched, current: stats(999) }], 9_999, ready([watched, stopped]));
    assert.equal(clock.isStable(10_000), false);
    assert.equal(clock.getIdleMs(10_000), 0);
    const targetMet = { ...stopped, current: stats(20) };
    clock.observeMachines('watch-only-context', [watched], 20_000, ready([watched, targetMet]));
    assert.equal(clock.isStable(29_999), false);
    clock.observeMachines('watch-only-context', [watched], 30_000, true);
    assert.equal(clock.isStable(30_000), true);
    clock.observeMachines('watch-only-context', [{ ...watched, current: stats(11) }], 30_001, true);
    assert.equal(clock.isStable(30_001), false, 'invalid earlier Auto999 never became a personal best');
    assert.equal(ready([watched]), true, 'pages with no explicit targets still watch Auto');
    assert.equal(clock.getElapsedMs(30_001), 30_001);
});


test('no checked or evaluable cards clears stagnation without erasing elapsed time', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    clock.observeMachines('watch', [machine({}, stats(10))], 0);
    assert.equal(clock.isStable(10_000), true);
    clock.observeMachines('none', [], 10_001);
    assert.equal(clock.isStable(20_000), false);
    assert.equal(clock.getElapsedMs(20_000), 20_000);
    const off = machine({ maximizeStats: { Performance: false, Quality: false, Efficiency: false } });
    clock.observeMachines('all-off', [off], 20_001);
    assert.equal(clock.isStable(40_000), false);
    assert.equal(clock.getElapsedMs(40_000), 40_000);
    clock.observeMachines('watched-again', [machine({}, stats(10))], 40_001);
    assert.equal(clock.isStable(50_000), false);
    assert.equal(clock.isStable(50_001), true);
});

test('protected target failures pause Auto records, while attainment and exact-target overshoot add no score', () => {
    const config = {
        degradationDays: 4,
        targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: true, Efficiency: false },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true },
    };
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.observeMachines('target', [machine(config, stats(25, 30), stats(16, 30))], 0, false);
    clock.observeMachines('target', [machine(config, stats(25, 999), stats(19, 30))], 9_999, false);
    assert.equal(clock.isStable(10_000), false);
    clock.observeMachines('target', [machine(config, stats(25, 30), stats(20, 30))], 10_001, true);
    clock.observeMachines('target', [machine(config, stats(27, 30), stats(22, 30))], 19_000, true);
    assert.equal(clock.isStable(20_001), true, 'target overshoot does not restart the quiet clock');
    clock.observeMachines('target', [machine(config, stats(30, 999), stats(19, 30))], 20_002, false);
    assert.equal(clock.isStable(30_000), false, 'losing a protected target suppresses the hint');
    clock.observeMachines('target', [machine(config, stats(25, 30), stats(20, 30))], 30_001, true);
    assert.equal(clock.isStable(30_001), true, 'qualification recovery neither resets records nor discards accumulated quiet time');
    clock.observeMachines('target', [machine(config, stats(25, 31), stats(20, 30))], 30_002, true);
    assert.equal(clock.isStable(30_002), false);
});


test('watched selection changes and dropdown changes preserve the same elapsed session', () => {
    const clock = createProgressClock({ idleMs: 60_000 });
    clock.start(1_000);
    clock.observeMachines('A', [namedMachine('A', {}, stats(10))], 1_000);
    clock.observeMachines('B', [namedMachine('B', {}, stats(5))], 20_000);
    assert.equal(clock.getElapsedMs(20_000), 19_000);
    assert.equal(clock.getIdleMs(20_000), 0);
    clock.setIdleMs(10_000);
    assert.equal(clock.isStable(30_000), true);
    clock.stop(31_500);
    assert.equal(clock.getElapsedMs(90_000), 30_500);
    assert.equal(clock.isStable(90_000), false);
});

test('unmet global targets freeze quiet time while real elapsed runtime continues', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    const watched = machine({}, stats(10));
    clock.observeMachines('run', [watched], 0, true);
    clock.observeMachines('run', [machine({}, stats(999))], 5_000, false);
    assert.equal(clock.getIdleMs(25_000), 5_000);
    assert.equal(clock.getElapsedMs(25_000), 25_000);
    assert.equal(clock.isStable(25_000), false);
    clock.observeMachines('run', [watched], 30_000, true);
    assert.equal(clock.getIdleMs(30_000), 5_000);
    assert.equal(clock.isStable(34_999), false);
    assert.equal(clock.isStable(35_000), true);
    clock.observeMachines('run', [watched], 36_000, false);
    assert.equal(clock.getIdleMs(46_000), 11_000);
    assert.equal(clock.isStable(46_000), false);
    clock.observeMachines('run', [watched], 46_000, true);
    assert.equal(clock.isStable(46_000), true);
    assert.equal(clock.getElapsedMs(46_000), 46_000);
});

test('global target pulses plus repeated A/B layout recovery do not restart personal records', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    const initial = [namedMachine('A', {}, stats(10)), namedMachine('B', {}, stats(20))];
    const swapped = [namedMachine('A', {}, stats(20)), namedMachine('B', {}, stats(10))];
    clock.observeMachines('run', initial, 0, true);
    clock.observeMachines('run', swapped, 9_000, true); // A earned its only new record.
    clock.observeMachines('run', initial, 18_000, false);
    clock.observeMachines('run', initial, 27_000, true); // B recovered, no new record.
    assert.equal(clock.getIdleMs(27_000), 9_000);
    clock.observeMachines('run', swapped, 27_500, false);
    clock.observeMachines('run', swapped, 36_500, true); // A recovered, no new record.
    assert.equal(clock.getIdleMs(36_500), 9_500);
    assert.equal(clock.isStable(37_000), true);
    clock.observeMachines('run', [namedMachine('A', {}, stats(21)), namedMachine('B', {}, stats(10))], 37_001, true);
    assert.equal(clock.isStable(37_001), false);
});

test('selection or objective changes clear personal records even while global targets remain unmet', () => {
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    clock.observeMachines('old-goals', [machine({}, stats(100))], 0, true);
    clock.observeMachines('new-goals', [machine({}, stats(200))], 5_000, false);
    clock.observeMachines('new-goals', [machine({}, stats(10))], 20_000, true);
    assert.equal(clock.getIdleMs(20_000), 0);
    assert.equal(clock.isStable(20_000), false);
    clock.observeMachines('new-goals', [machine({}, stats(11))], 29_999, true);
    assert.equal(clock.isStable(30_000), false, 'new context was not held to the old100 or invalid200 record');
    assert.equal(clock.getElapsedMs(30_000), 30_000);
});

test('target-only watched cards never create an Auto stagnation notice', () => {
    const targeted = machine({ targetStats: { Performance: 20, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false } }, stats(20));
    const clock = createProgressClock({ idleMs: 10_000 });
    clock.start(0);
    clock.observeMachines('targets-only', [targeted], 0, true);
    assert.equal(clock.isStable(10_000), false);
    assert.equal(clock.getElapsedMs(10_000), 10_000);
});
