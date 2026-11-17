import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { runOptimizationEngine, stallOrders } = await server.ssrLoadModule('/src/solver/engine.ts');
const { calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { projectDegradation } = await server.ssrLoadModule('/src/degradation.ts');
test.after(async () => { await server.close(); });
const stats = (Performance, Quality, Efficiency) => ({ Performance, Quality, Efficiency });
const module = (id, baseStats, degrading = false) => ({
    id, shape: 'Square4_Base', color: 'Red', displayName: 'Performance', baseStats,
    effects: [degrading ? 'Degrading' : 'None', 'None'], effectValues: [degrading ? 17 : 0, 0],
});
const fragile = module('fragile', stats(1, 1, 1), true);
const empty = () => Array.from({ length: 5 }, (_, y) => Array.from({ length: 7 }, (_, x) => x < 2 && y < 2 ? null : 'Locked'));
const config = (targets, degradationUses) => ({
    id: 'machine', tier: 3, degradationDays: 2, degradationUses,
    targetStats: { Performance: targets.Performance, Quality: null, Efficiency: targets.Efficiency },
    maximizeStats: { Performance: false, Quality: true, Efficiency: false },
    ignoreStats: { Performance: false, Quality: false, Efficiency: false },
});
async function solve(machine, inventory) {
    let checks = 0, randomState = 42, result;
    const random = Math.random;
    Math.random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 0x100000000);
    try {
        await runOptimizationEngine([machine], [empty()], inventory, inventory,
            { get current() { return ++checks < 1200; } }, updates => { result = updates.get(machine.id); },
            { stall: 0, polish: 0, windowOneIn: 0, swapOneIn: 0, relayoutOneIn: 0 });
    } finally { Math.random = random; }
    assert.ok(result);
    return result;
}
const projected = (board, uses, inventory) => calculateBoardStats(board, inventory.map(item => projectDegradation(item, uses))).totals;

test('normal two-day tasks protect only the pre-use snapshot needed by the finishing action', async () => {
    const targets = stats(16, 0, 16);
    const durable = module('durable', stats(16, 0, 16));
    const inventory = [fragile, durable];
    const out = await solve(config(targets, stats(1, 1, 1)), inventory);
    assert.equal(out.board[0][0].id, 'fragile');
    assert.deepEqual(out.totals, stats(17, 17, 17), 'displayed values remain today’s values');
    assert.equal(projected(out.board, 1, inventory).Efficiency, 16);
    assert.equal(projected(out.board, 2, inventory).Efficiency, 15, 'finishing degradation need not be protected');
});

test('Desequencer uses its final post-use Performance but pre-use Efficiency on the same board', async () => {
    const durable = module('durable', stats(15, 0, 16));
    const inventory = [fragile, durable];
    const out = await solve(config(stats(15, 0, 16), stats(2, 1, 1)), inventory);
    assert.equal(out.board[0][0].id, 'fragile');
    assert.deepEqual(out.totals, stats(17, 17, 17));
    assert.equal(projected(out.board, 2, inventory).Performance, 15);
    assert.equal(projected(out.board, 1, inventory).Efficiency, 16);
    const legacy = await solve(config(stats(15, 0, 16), undefined), inventory);
    assert.equal(legacy.board[0][0].id, 'durable', 'the existing global two-use horizon remains the fallback');
});

test('an explicit zero-use map protects today without an unnecessary extra degradation use', async () => {
    const durable = module('durable', stats(17, 0, 17));
    const inventory = [fragile, durable];
    const machine = { ...config(stats(17, 0, 17), stats(0, 0, 0)), degradationDays: 0 };
    const out = await solve(machine, inventory);
    assert.equal(out.board[0][0].id, 'fragile');
    assert.deepEqual(out.totals, stats(17, 17, 17));
    assert.deepEqual(stallOrders([{ ...machine, targetSteps: { Performance: [10, 17] } }], [[17, null, 17]], [[false, false, false]], () => 0), []);
});
