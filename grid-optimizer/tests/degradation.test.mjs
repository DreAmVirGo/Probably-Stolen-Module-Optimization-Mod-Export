import assert from 'node:assert/strict';
import test from 'node:test';
import { degradationLifetime, firstThresholdFailure, projectDegradation } from '../src/degradation.ts';

const module = (effects = ['Degrading', 'Receiver'], effectValues = [48, 0]) => ({
    id: 'decaying', shape: 'Square4_High', color: 'Red', displayName: 'Performance Module', effects, effectValues,
});

test('degradation projects remaining percentage points, floors at zero, and preserves identity', () => {
    const item = module();
    const after = projectDegradation(item, 4);
    assert.equal(after.id, item.id);
    assert.deepEqual(after.effectValues, [44, 0]);
    assert.deepEqual(item.effectValues, [48, 0]);
    assert.deepEqual(projectDegradation(item, 100).effectValues, [0, 0]);
});

test('projects either effect slot without promising learning gains or changing other effects', () => {
    const item = module(['Top Mount', 'Degrading'], [17, 8]);
    assert.deepEqual(projectDegradation(item, 3).effectValues, [17, 5]);
    const learning = module(['Learning Algorithm', 'Receiver'], [8, 0]);
    assert.equal(projectDegradation(learning, 20), learning);
});

test('current and invalid snapshots retain their original inventory object', () => {
    const item = module();
    for (const uses of [0, -1, NaN, Infinity, 0.5]) assert.equal(projectDegradation(item, uses), item);
    assert.deepEqual(projectDegradation(item, 2.9).effectValues, [46, 0]);
});

test('lifetime ignores stable and learning modules and handles either degrading slot', () => {
    assert.equal(degradationLifetime([]), 0);
    assert.equal(degradationLifetime([
        module(), module(['Receiver', 'Degrading'], [0, 63]),
        module(['Learning Algorithm', 'Receiver'], [100, 0]),
    ]), 63);
});

test('being stuck does not prevent an existing degrading effect from aging', () => {
    const item = { ...module(), isStuck: true };
    assert.deepEqual(projectDegradation(item, 4).effectValues, [44, 0]);
    assert.equal(degradationLifetime([item]), 48);
});

test('finds the first strictly sub-threshold day and treats equality as safe', () => {
    assert.equal(firstThresholdFailure(day => 100 - day, 98, 10), 3);
    assert.equal(firstThresholdFailure(day => 100 - day, 98, 2), null);
    assert.equal(firstThresholdFailure(day => 100 - day, 101, 10), 0);
    assert.equal(firstThresholdFailure(() => 100, 100, 0), null);
    assert.equal(firstThresholdFailure(() => 100, 100, 100), null);
});

test('finds discrete rounded drops efficiently without assuming a linear slope', () => {
    const calls = [];
    const failure = firstThresholdFailure(day => {
        calls.push(day);
        return 100 - Math.floor(day / 8);
    }, 95, 1024);
    assert.equal(failure, 48);
    assert.ok(calls.length <= 13);
    assert.equal(firstThresholdFailure(day => 100 - day, 98, 2.9), null);
});

test('prediction evaluates actual node, receiver, feedback and zero-crossing board effects', async () => {
    // Use the app's SSR loader: the React hook module also imports browser solver
    // backends, which use Vite's extensionless and directory import resolution.
    const { createServer } = await import('vite');
    const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
    try {
        const { calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
        const degrading = { ...module(['Degrading', 'Receiver'], [14, 0]), shape: 'Square4_High' };
        const feedback = { ...module(['Negative Feedback', 'None'], [0, 0]), id: 'feedback', color: 'Green' };
        const node = { ...module(['None', 'None'], [0, 0]), id: 'node', shape: 'Node1x2', color: 'White' };
        const inventory = [degrading, feedback, node];
        const board = Array.from({ length: 5 }, () => Array(7).fill(null));
        // Degrading at (0,0), node along its right edge; NF along its bottom edge.
        board[0][0] = board[0][1] = board[1][0] = board[1][1] = degrading;
        board[0][2] = board[1][2] = node;
        board[2][0] = board[2][1] = board[3][0] = board[3][1] = feedback;
        const readings = [];
        const valueAt = day => {
            const projected = inventory.map(item => projectDegradation(item, day));
            return calculateBoardStats(board, projected).totals.Performance;
        };
        for (let day = 0; day <= 14; day++) readings.push(valueAt(day));
        assert.deepEqual(readings, [-3, -4, -5, -6, -7, -10, -11, -12, -13, -14, -16, -17, -18, -19, -20]);
        // Receiver/node rounding and NF's negative Performance make this differ
        // from subtracting one per night from today's already-combined total.
        assert.ok(readings.every((value, i) => i === 0 || value <= readings[i - 1]));
        assert.notEqual(readings[14], readings[0] - 14);
        assert.equal(firstThresholdFailure(valueAt, readings[2], 14), 3);
    } finally {
        await server.close();
    }
});
