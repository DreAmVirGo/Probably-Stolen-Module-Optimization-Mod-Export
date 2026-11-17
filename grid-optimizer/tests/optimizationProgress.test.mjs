import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressClock, progressScore, progressTargetsMet } from '../src/optimizationProgress.ts';

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

test('hint requires both 90 seconds running and 60 seconds without progress', () => {
    const clock = createProgressClock();
    clock.observe('run1', [0, 10], 0);
    assert.equal(clock.isStable(59_999), false);
    assert.equal(clock.isStable(89_999), false);
    assert.equal(clock.isStable(90_000), true);
    clock.observe('run1', [0, 11], 90_001);
    assert.equal(clock.isStable(90_001), false);
    assert.equal(clock.isStable(150_000), false);
    assert.equal(clock.isStable(150_001), true);
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

test('stopping, restarting or changing the context starts a fresh warmup', () => {
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
