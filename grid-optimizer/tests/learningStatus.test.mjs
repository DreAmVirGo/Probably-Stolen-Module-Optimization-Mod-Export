import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
    resolve(specifier, context, nextResolve) {
        return nextResolve(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
    },
});
const { canMachineTrainLearning, getLearningProgress, summariseLearning } = await import('../src/learningStatus.ts');

const module = (id, current = 0, extra = {}) => ({
    id, shape: 'L3', color: 'Red', displayName: 'Performance Module',
    effects: ['Learning Algorithm', 'None'], effectValues: [current, 0], ...extra,
});
const board = item => [[item, item], [item, 'Locked']];

test('reports saved learning values with the shaped module cap, including full modules', () => {
    assert.deepEqual(getLearningProgress(module('new')), { current: 0, cap: 24 });
    assert.deepEqual(getLearningProgress(module('half', 12)), { current: 12, cap: 24 });
    assert.deepEqual(getLearningProgress(module('full', 24)), { current: 24, cap: 24 });
    assert.deepEqual(getLearningProgress(module('above', 30)), { current: 30, cap: 24 });
    assert.deepEqual(getLearningProgress(module('yellow', 20, {
        shape: 'C5', color: 'Yellow', displayName: 'Refinement Module',
        effects: ['Receiver', 'Learning Algorithm'], effectValues: [0, 20],
    })), { current: 20, cap: 62 });
});

test('saved baseStats do not turn current progress into a false cap', () => {
    assert.deepEqual(getLearningProgress(module('saved', 12, {
        baseStats: { Performance: 12, Quality: 0, Efficiency: 0 },
    })), { current: 12, cap: 24 });
    assert.deepEqual(getLearningProgress(module('saved-zero', 0, {
        baseStats: { Performance: 0, Quality: 0, Efficiency: 0 },
    })), { current: 0, cap: 24 });
});

test('ignores nonlearning and unusable progression records', () => {
    assert.equal(getLearningProgress(module('ordinary', 10, { effects: ['None', 'Receiver'] })), null);
    assert.equal(getLearningProgress(module('node', 0, { shape: 'Node1x2', color: 'White' })), null);
    assert.equal(getLearningProgress(module('double', 0, { effects: ['Learning Algorithm', 'Learning Algorithm'] })), null);
    for (const current of [NaN, Infinity, -1, 1.5, undefined]) assert.equal(getLearningProgress(module('invalid', 0, { effectValues: [current, 0] })), null);
});

test('counts all unfinished real modules once, without treating maxed modules as idle', () => {
    const placed = module('placed', 10, { uid: 7 });
    const idle = module('idle', 5, { uid: 8 });
    const full = module('full', 24);
    const summary = summariseLearning([placed, idle, full, placed], [
        { id: 'm1', name: 'Inv. > Furnace 1', board: board(placed) },
        { id: 'm2', name: 'Inv. > Furnace 2', board: [[placed]] },
    ]);
    assert.deepEqual({ count: summary.count, placed: summary.placedCount, idle: summary.idleCount }, { count: 2, placed: 1, idle: 1 });
    assert.deepEqual(summary.entries.map(({ id, current, cap, machineId, machineName }) => ({ id, current, cap, machineId, machineName })), [
        { id: 'placed', current: 10, cap: 24, machineId: 'm1', machineName: 'Inv. > Furnace 1' },
        { id: 'idle', current: 5, cap: 24, machineId: null, machineName: null },
    ]);
});

test('excludes unlimited templates and their clones even when they appear on boards', () => {
    const real = module('real');
    const unlimited = module('unlimited', 0, { isInfinite: true });
    const clone = module('unlimited_clone_1');
    const summary = summariseLearning([real, unlimited, clone], [{ id: 'm', name: 'Furnace', board: [[unlimited, clone]] }]);
    assert.equal(summary.count, 1);
    assert.equal(summary.placedCount, 0);
    assert.equal(summary.idleCount, 1);
});

test('matches stable physical uid across aliases and includes placed locked or stuck modules', () => {
    const locked = module('locked', 10, { uid: 42, isLocked: true });
    const alias = { ...locked, id: 'alias-from-old-board' };
    const stuck = module('stuck', 12, { uid: 43, isStuck: true });
    const summary = summariseLearning([locked, { ...locked, id: 'duplicate' }, stuck], [
        { id: 'stopped-locked-machine', name: 'Locked machine', board: [[alias, stuck, stuck]] },
    ]);
    assert.equal(summary.count, 2);
    assert.equal(summary.placedCount, 2);
    assert.equal(summary.idleCount, 0);
    assert.deepEqual(summary.entries.map(entry => entry.machineId), ['stopped-locked-machine', 'stopped-locked-machine']);
});

test('placement uses canonical inventory progression, not a stale board copy', () => {
    const current = module('current', 24);
    const stale = module('current', 0);
    assert.deepEqual(summariseLearning([current], [{ id: 'm', name: 'Machine', board: board(stale) }]), {
        count: 0, placedCount: 0, idleCount: 0, blockedCount: 0, entries: [],
    });
});

test('Deal Maker cannot train while Alarm and other working machines can', () => {
    for (const name of ['Deal Maker', 'deal_maker', ' DEAL_MAKER ', 'Inv. > Bay 1 > Deal Maker 2']) {
        assert.equal(canMachineTrainLearning(name), false, name);
    }
    for (const name of ['Alarm System', 'security_alarm', 'Inv. > Alarm System 1', 'Furnace', 'Hydroponic System']) {
        assert.equal(canMachineTrainLearning(name), true, name);
    }
});

test('nontraining placements remain placed, with a distinct blocked count and idle state', () => {
    const blocked = module('blocked');
    const training = module('training');
    const idle = module('idle');
    const summary = summariseLearning([blocked, training, idle], [
        { id: 'deal', name: 'Deal Maker', board: board(blocked), canTrainLearning: false },
        { id: 'alarm', name: 'Alarm System', board: board(training) },
    ]);
    assert.equal(summary.count, 3);
    assert.equal(summary.placedCount, 2);
    assert.equal(summary.idleCount, 1);
    assert.equal(summary.blockedCount, 1);
    assert.deepEqual(summary.entries.map(({ id, machineId, canTrainLearning }) => ({ id, machineId, canTrainLearning })), [
        { id: 'blocked', machineId: 'deal', canTrainLearning: false },
        { id: 'training', machineId: 'alarm', canTrainLearning: true },
        { id: 'idle', machineId: null, canTrainLearning: null },
    ]);
});
