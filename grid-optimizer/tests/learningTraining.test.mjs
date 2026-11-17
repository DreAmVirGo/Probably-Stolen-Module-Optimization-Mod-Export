import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
const { calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { projectDegradation } = await server.ssrLoadModule('/src/degradation.ts');
test.after(async () => { await server.close(); });

const stats = (Performance = 0, Quality = 0, Efficiency = 0) => ({ Performance, Quality, Efficiency });
const learner = (id, color = 'Red', shape = 'L3', current = 0, extra = {}) => ({
    id, shape, color, displayName: color === 'Red' ? (shape.includes('High') ? 'Overclock' : 'Performance')
        : color === 'Yellow' ? 'Quality' : 'Efficiency',
    effects: ['Learning Algorithm', 'None'], effectValues: [current, 0], ...extra,
});
const base = extra => ({
    id: 'machine', tier: 3, degradationDays: 4,
    targetStats: { Performance: null, Quality: null, Efficiency: 0 },
    maximizeStats: { Performance: false, Quality: false, Efficiency: false },
    ignoreStats: { Performance: true, Quality: true, Efficiency: false }, ...extra,
});
const empty = (width = 7, height = 5) => Array.from({ length: 5 }, (_, y) => Array.from({ length: 7 }, (_, x) => x < width && y < height ? null : 'Locked'));
const placed = board => new Set(board.flat().filter(cell => cell && cell !== 'Locked').map(cell => cell.id));
const solveReportOnly = async (machine, inventory, board, pool = inventory) => {
    let report;
    // An optimized board need not produce another search record. Its initial/final
    // report must still offer harmless free cells to the unused learners.
    await runOptimizationEngine([machine], [board], pool, inventory, { current: false }, updates => { report = updates.get('machine'); }, { stall: 0 });
    return report ?? { board, totals: calculateBoardStats(board, inventory).totals };
};

test('unused regular learners fill harmless space even with an Efficiency target and no new search record', async () => {
    const training = [learner('performance'), learner('quality', 'Yellow'), learner('efficiency', 'Green')];
    const board = empty();
    const out = await solveReportOnly(base(), training, board);
    assert.deepEqual(placed(out.board), new Set(training.map(item => item.id)));
    assert.deepEqual(out.totals, stats());
    assert.equal(placed(board).size, 0, 'training changes the reported copy, not the search board');
});

test('maxed, locked, stuck, cloned and externally held learners are left untouched', async () => {
    const candidates = [
        learner('maxed', 'Red', 'L3', 24),
        learner('maxed-overclock', 'Red', 'Square4_High', 72),
        learner('locked', 'Red', 'L3', 0, { isLocked: true }),
        learner('stuck', 'Red', 'L3', 0, { isStuck: true }),
        learner('source_clone_0'),
        learner('outside'),
    ];
    const out = await solveReportOnly(base(), candidates, empty(), candidates.map(item => item.id === 'outside' ? { ...item, isLocked: true } : item));
    assert.equal(placed(out.board).size, 0);
});

test('training never worsens a currently optimized Auto stat', async () => {
    const overclock = learner('overclock', 'Red', 'Square4_High', 0);
    const machine = base({ targetStats: { Performance: null, Quality: null, Efficiency: null }, maximizeStats: { Performance: false, Quality: false, Efficiency: true } });
    const out = await solveReportOnly(machine, [overclock], empty());
    assert.equal(placed(out.board).has(overclock.id), false);
    assert.equal(out.totals.Efficiency, 0);
});

test('exact node effects cannot push an already met target below its threshold', async () => {
    const source = { ...learner('fixed'), effects: ['None', 'None'], effectValues: [0, 0], shape: 'Square4_Base',
        isStuck: true, baseStats: stats(0, 0, 30) };
    const node = { ...learner('node'), shape: 'Node1x2', color: 'White', effects: ['None', 'None'], effectValues: [0, 0], isLocked: true };
    const overclock = learner('overclock', 'Red', 'Square4_High', 30);
    const board = empty(5, 2);
    board[0][0] = board[0][1] = board[1][0] = board[1][1] = source;
    board[0][2] = board[1][2] = node;
    const inventory = [source, node, overclock];
    assert.equal(calculateBoardStats(board, inventory).totals.Efficiency, 36);
    const wouldFail = board.map(row => row.slice());
    wouldFail[0][3] = wouldFail[0][4] = wouldFail[1][3] = wouldFail[1][4] = overclock;
    assert.equal(calculateBoardStats(wouldFail, inventory).totals.Efficiency, 19);
    const out = await solveReportOnly(base({ targetStats: { Performance: null, Quality: null, Efficiency: 20 } }), inventory, board, [overclock]);
    assert.equal(placed(out.board).has(overclock.id), false);
    assert.equal(out.totals.Efficiency, 36);
});

test('the original degradation horizon, rather than current overshoot, protects target safety', async () => {
    const degrading = { ...learner('degrading', 'Green', 'Square4_Base'), effects: ['Degrading', 'None'], effectValues: [20, 0], isLocked: true };
    const overclock = learner('overclock', 'Red', 'Square4_High', 40);
    const board = empty(4, 2);
    board[0][0] = board[0][1] = board[1][0] = board[1][1] = degrading;
    const inventory = [degrading, overclock];
    const wouldFail = board.map(row => row.slice());
    wouldFail[0][2] = wouldFail[0][3] = wouldFail[1][2] = wouldFail[1][3] = overclock;
    assert.equal(calculateBoardStats(wouldFail, inventory).totals.Efficiency, 16);
    const forecast = inventory.map(item => projectDegradation(item, 4));
    assert.equal(calculateBoardStats(wouldFail, forecast).totals.Efficiency, 12);
    const out = await solveReportOnly(base({ targetStats: { Performance: null, Quality: null, Efficiency: 16 } }), inventory, board, [overclock]);
    assert.equal(placed(out.board).has(overclock.id), false);
    assert.equal(out.totals.Efficiency, 20);
});

test('a currently unmet original target is never worsened by the training pass', async () => {
    const harmful = learner('refinement', 'Yellow', 'Square4_High', 0);
    const machine = base({ targetStats: { Performance: 10, Quality: null, Efficiency: null }, ignoreStats: { Performance: false, Quality: true, Efficiency: true } });
    const out = await solveReportOnly(machine, [harmful], empty());
    assert.equal(placed(out.board).has(harmful.id), false);
    assert.equal(out.totals.Performance, 0);
});

test('AgeWell and Mirage folded targets use the combined reading during training', async () => {
    const overclock = learner('overclock', 'Red', 'Square4_High', 30);
    const agewell = base({ sumPE: true });
    const agewellOut = await solveReportOnly(agewell, [overclock], empty(2, 2));
    assert.equal(placed(agewellOut.board).has(overclock.id), true);
    assert.ok(agewellOut.totals.Performance + agewellOut.totals.Efficiency >= 0);
    assert.ok(agewellOut.totals.Efficiency < 0, 'raw Efficiency alone would incorrectly block the folded target');

    const refinement = learner('refinement', 'Yellow', 'Square4_High', 10);
    const mirage = base({ sumPQ: true, targetStats: { Performance: 20, Quality: null, Efficiency: null },
        ignoreStats: { Performance: false, Quality: false, Efficiency: true } });
    const mirageOut = await solveReportOnly(mirage, [refinement], empty(2, 2));
    assert.equal(placed(mirageOut.board).has(refinement.id), true);
    assert.ok(mirageOut.totals.Performance + 2 * mirageOut.totals.Quality >= 20);
});

test('harmless training respects capped Auto output instead of raw overshoot', async () => {
    const source = { ...learner('fixed'), effects: ['None', 'None'], effectValues: [0, 0], shape: 'Square4_Base',
        isStuck: true, baseStats: stats(600) };
    const eco = learner('eco', 'Green', 'Square4_High', 0);
    const board = empty(4, 2);
    board[0][0] = board[0][1] = board[1][0] = board[1][1] = source;
    const machine = base({ performanceCap: 500, targetStats: { Performance: null, Quality: null, Efficiency: null },
        maximizeStats: { Performance: true, Quality: false, Efficiency: false },
        ignoreStats: { Performance: false, Quality: true, Efficiency: true } });
    const out = await solveReportOnly(machine, [source, eco], board, [eco]);
    assert.equal(placed(out.board).has(eco.id), true);
    assert.ok(out.totals.Performance >= 500);
    assert.ok(out.totals.Performance < 600);
});

test('training gains do not reassign an unmet-target layout onto a card whose target was met', async () => {
    const source = { ...learner('source'), shape: 'Square4_Base', effects: ['None', 'None'], effectValues: [0, 0], baseStats: stats(5, 0, 10) };
    const training = learner('training', 'Red', 'Square4_Base', 12);
    const first = empty(2, 2), second = empty(2, 2);
    first[0][0] = first[0][1] = first[1][0] = first[1][1] = source;
    const config = base({ targetStats: { Performance: null, Quality: null, Efficiency: 10 },
        maximizeStats: { Performance: true, Quality: false, Efficiency: false },
        ignoreStats: { Performance: false, Quality: true, Efficiency: false } });
    let updates;
    await runOptimizationEngine([{ ...config, id: 'first' }, { ...config, id: 'second' }], [first, second], [training], [source, training],
        { current: false }, out => { updates = out; }, { stall: 0 });
    assert.ok(updates);
    assert.equal(updates.get('first').totals.Efficiency, 10);
    assert.equal(placed(updates.get('first').board).has(source.id), true);
    assert.equal(placed(updates.get('second').board).has(training.id), true);
    assert.equal(updates.get('second').totals.Performance, 12);
    assert.equal(updates.get('second').ownTotals.Performance, 0, 'coordinator uses the actual untrained search layout');
});

test('machines that never advance learning receive no spare training filler', async () => {
    const training = learner('training');
    const out = await solveReportOnly(base({ canTrainLearning: false }), [training], empty());
    assert.equal(placed(out.board).has(training.id), false);
    const regular = await solveReportOnly(base(), [training], empty());
    assert.equal(placed(regular.board).has(training.id), true, 'existing callers default to a machine that can train');
});

test('joint reporting places spare learners only on eligible training machines', async () => {
    const training = learner('training');
    const inert = { ...base({ canTrainLearning: false }), id: 'inert' };
    const active = { ...base({ canTrainLearning: true }), id: 'active' };
    let updates;
    await runOptimizationEngine([inert, active], [empty(), empty()], [training], [training], { current: false },
        out => { updates = out; }, { stall: 0 });
    assert.ok(updates);
    assert.equal(placed(updates.get('inert').board).has(training.id), false);
    assert.equal(placed(updates.get('active').board).has(training.id), true);
});
