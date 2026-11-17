import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { editInventoryItem, validateModuleStats, MIN_MODULE_STAT, MAX_MODULE_STAT } from '../src/inventoryEditing.ts';
import { degradationLifetime, projectDegradation } from '../src/degradation.ts';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const mainUtils = await server.ssrLoadModule('/src/utils.ts');
const hoydoyUtils = await server.ssrLoadModule('/src/solvers/hoydoy/utils.ts');
const razboyUtils = await server.ssrLoadModule('/src/solvers/razboy/utils.ts');
const { calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { calculateBoardStats: hoydoyBoard } = await server.ssrLoadModule('/src/solvers/hoydoy/engine.ts');
const { calculateBoardStats: razboyBoard } = await server.ssrLoadModule('/src/solvers/razboy/solver/boardStats.ts');
const { createTypedCore } = await server.ssrLoadModule('/src/solver/typedCore.ts');
const { buildPoolTables } = await server.ssrLoadModule('/src/solvers/razboy/solver/tables.ts');
const { boardTotals } = await server.ssrLoadModule('/src/solvers/razboy/solver/boardTotals.ts');
const { toIndexBoard } = await server.ssrLoadModule('/src/solvers/razboy/solver/indexBoard.ts');
const { getLearningProgress } = await server.ssrLoadModule('/src/learningStatus.ts');
test.after(async () => { await server.close(); });
const stats = (Performance = 0, Quality = 0, Efficiency = 0) => ({ Performance, Quality, Efficiency });
const item = extra => ({
    id: 'module', uid: 1234, shape: 'L3', color: 'Red', displayName: 'Performance',
    effects: ['Negative Feedback', 'Degrading'], effectValues: [0, 27],
    originalPath: 'Inv. > Bay 1', isLocked: true, isInfinite: false, ...extra,
});

test('edits preserve physical identity and traits while keeping a current value above the fresh cap', () => {
    const original = item();
    const supplied = stats(67, 0, -22);
    const edited = editInventoryItem(original, supplied);
    for (const key of ['id', 'uid', 'shape', 'color', 'displayName', 'originalPath', 'isLocked', 'isInfinite']) assert.equal(edited[key], original[key]);
    assert.equal(edited.effects, original.effects);
    assert.notEqual(edited.effectValues, original.effectValues);
    assert.deepEqual(edited.effectValues, [0, 67]);
    assert.deepEqual(original.effectValues, [0, 27]);
    assert.deepEqual(edited.currentStats, supplied);
    assert.notEqual(edited.currentStats, supplied);
    supplied.Performance = 99;
    assert.equal(edited.currentStats.Performance, 67);
    assert.equal(original.currentStats, undefined);
    assert.equal(mainUtils.getBaseStats(edited).Performance, 12, 'the shaped base remains the ordinary base');
});

test('current snapshots bypass internal multipliers in all backends without changing ordinary modules', () => {
    for (const effects of [['Negative Feedback', 'Degrading'], ['Degrading', 'Negative Feedback'], ['Premium', 'Overcharged']]) {
        const original = item({ effects });
        const edited = editInventoryItem(original, stats(67, -3, -22));
        for (const utils of [mainUtils, hoydoyUtils, razboyUtils]) {
            assert.deepEqual(utils.applyInternalEffects(edited), stats(67, -3, -22));
            const read = utils.applyInternalEffects(edited);
            read.Performance = -99;
            assert.equal(edited.currentStats.Performance, 67);
        }
    }
    assert.equal(mainUtils.applyInternalEffects(item()).Performance, 27, 'imported scalar remains authoritative without a manual snapshot');
});

test('edited degradation ages positive axes, preserves negatives, and does not repeat other multipliers', () => {
    const edited = editInventoryItem(item(), stats(67, 3, -22));
    const after = projectDegradation(edited, 4);
    assert.deepEqual(after.currentStats, stats(63, 0, -22));
    assert.deepEqual(after.effectValues, [0, 63]);
    assert.deepEqual(mainUtils.applyInternalEffects(after), stats(63, 0, -22));
    assert.equal(degradationLifetime([edited]), 67);
    assert.deepEqual(projectDegradation(edited, 100).currentStats, stats(0, 0, -22));
    assert.deepEqual(edited.currentStats, stats(67, 3, -22));
    assert.equal(projectDegradation(edited, 0), edited);
});

test('each native Degrading occurrence consumes one point per use in snapshots and ordinary values', () => {
    const original = item({ effects: ['Degrading', 'Degrading'], effectValues: [27, 27] });
    const projected = projectDegradation(original, 1);
    assert.deepEqual(projected.effectValues, [25, 25]);
    assert.equal(mainUtils.applyInternalEffects(projected).Performance, 25);
    assert.equal(degradationLifetime([original]), 14);
    const edited = editInventoryItem(original, stats(7, 3, -8));
    assert.deepEqual(projectDegradation(edited, 1).currentStats, stats(5, 1, -8));
    assert.deepEqual(projectDegradation(edited, 2).currentStats, stats(3, 0, -8));
    assert.deepEqual(projectDegradation(edited, 4).currentStats, stats(0, 0, -8));
    assert.equal(degradationLifetime([edited]), 4);
});

test('learning metadata uses the edited primary reading without granting future learning or raising the shaped cap', () => {
    const learning = item({ effects: ['Learning Algorithm', 'Receiver'], effectValues: [4, 0] });
    const edited = editInventoryItem(learning, stats(67, 0, -3));
    assert.deepEqual(edited.effectValues, [67, 0]);
    assert.deepEqual(getLearningProgress(edited), { current: 67, cap: 24 });
    assert.equal(projectDegradation(edited, 100), edited);
    assert.equal(degradationLifetime([edited]), 0);
    const negativePrimary = editInventoryItem(learning, stats(-4, 0, -3));
    assert.deepEqual(negativePrimary.effectValues, [4, 0], 'a negative primary stat is not invented as a learning scalar');
});

test('snapshot stats still receive placement effects and all full-board evaluators agree', () => {
    const edited = editInventoryItem(item({ shape: 'Square4_Base', color: 'Green', effects: ['Negative Feedback', 'Receiver'], effectValues: [0, 0] }), stats(-8, 0, 30));
    const refinement = item({ id: 'refinement', shape: 'C5', color: 'Yellow', displayName: 'Refinement', effects: ['None', 'None'], effectValues: [0, 0] });
    const node = item({ id: 'node', shape: 'Node1x2', color: 'White', displayName: 'Node', effects: ['None', 'None'], effectValues: [0, 0] });
    const inventory = [edited, refinement, node];
    const board = Array.from({ length: 5 }, () => Array(7).fill(null));
    const put = (module, x, y) => { for (const offset of mainUtils.PRECOMPUTED_OFFSETS.get(module.shape)[0]) board[y + offset.y][x + offset.x] = module; };
    put(edited, 0, 0); put(refinement, 2, 0); put(node, 0, 2);
    const expected = calculateBoardStats(board, inventory);
    assert.deepEqual(expected.totals, stats(-21, 31, 17));
    for (const evaluate of [hoydoyBoard, razboyBoard]) {
        const actual = evaluate(board, inventory);
        assert.deepEqual(actual.totals, expected.totals);
        assert.deepEqual(actual.pieceStats, expected.pieceStats);
    }
    const core = createTypedCore(inventory, mainUtils.applyInternalEffects);
    const typed = Int16Array.from(board.flat().map(cell => cell ? core.indexOf.get(cell.id) : -1));
    const totals = core.boardTotals(typed);
    assert.deepEqual([totals.p, totals.q, totals.e], Object.values(expected.totals));
    const tables = buildPoolTables(inventory, [board]);
    const razTotals = { p: 0, q: 0, e: 0, pieces: 0 };
    boardTotals(tables, toIndexBoard(board, tables.indexOf), razTotals);
    assert.deepEqual([razTotals.p, razTotals.q, razTotals.e], Object.values(expected.totals));
});

test('validation accepts signed whole legacy-range stats and rejects invalid drafts without mutation', () => {
    assert.equal(MIN_MODULE_STAT, -2048);
    assert.equal(MAX_MODULE_STAT, 2047);
    assert.equal(validateModuleStats(stats(MIN_MODULE_STAT, 0, MAX_MODULE_STAT)), true);
    for (const invalid of [null, [], {}, stats(NaN), stats(Infinity), stats(-Infinity), stats(1.2), stats(2048), stats(-2049), stats('12')]) {
        assert.equal(validateModuleStats(invalid), false);
        assert.throws(() => editInventoryItem(item(), invalid), RangeError);
    }
});
