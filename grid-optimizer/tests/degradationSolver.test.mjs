import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { runOptimizationEngine, stallOrders } = await server.ssrLoadModule('/src/solver/engine.ts');
const { calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { projectDegradation } = await server.ssrLoadModule('/src/degradation.ts');
const item = (id, p, q, effects = ['None', 'None'], values = [0, 0]) => ({
    id, displayName: 'Performance Module', shape: 'Square4_Base', color: 'Red', effects, effectValues: values,
    baseStats: { Performance: p, Quality: q, Efficiency: 0 },
});
const card = (target = 15, days = 8) => ({
    id: 'machine', tier: 3, degradationDays: days,
    targetStats: { Performance: target, Quality: null, Efficiency: null },
    maximizeStats: { Performance: target === null, Quality: true, Efficiency: false },
    ignoreStats: { Performance: false, Quality: false, Efficiency: true },
});
const board = () => Array.from({ length: 5 }, (_, y) => Array.from({ length: 7 }, (_, x) => x < 2 && y < 2 ? null : 'Locked'));
async function solve(machine, inventory, initial = board()) {
    let checks = 0, state = 12345, last;
    const random = Math.random;
    Math.random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000);
    try {
        await runOptimizationEngine([machine], [initial], inventory.filter(it => !it.isStuck), inventory,
            { get current() { return ++checks < 1200; } }, updates => { last = updates.get('machine'); },
            { stall: 0, polish: 0, windowOneIn: 0, swapOneIn: 0, relayoutOneIn: 0 });
    } finally { Math.random = random; }
    return last ?? { board: initial, totals: calculateBoardStats(initial, inventory).totals };
}
try {
    test('chooses a durable module for a protected target and preserves current displayed stats', async () => {
        const fragile = item('fragile', 16, 0, ['Degrading', 'None'], [20, 0]);
        const durable = item('durable', 15, 0);
        const out = await solve(card(), [fragile, durable]);
        assert.equal(out.board.flat().find(cell => cell && cell !== 'Locked').id, 'durable');
        assert.equal(out.totals.Performance, 15);
        for (let day = 0; day <= 8; day++) {
            const projected = out.board.map(row => row.map(cell => cell && cell !== 'Locked' ? projectDegradation(cell, day) : cell));
            assert.ok(calculateBoardStats(projected, [durable]).totals.Performance >= 15);
        }
    });
    test('Auto is maximized using today rather than the decayed target horizon', async () => {
        const fragile = item('fragile', 16, 8, ['Degrading', 'None'], [20, 0]);
        const durable = item('durable', 12, 19);
        const out = await solve(card(12), [fragile, durable]);
        assert.equal(out.board.flat().find(cell => cell && cell !== 'Locked').id, 'fragile');
        assert.equal(out.totals.Quality, 20);
        assert.equal(projectDegradation(fragile, 8).effectValues[0], 12);
    });
    test('future node bonuses and folded AgeWell energy targets use the complete board', async () => {
        const stuck = { ...item('stuck', 16, 0, ['Degrading', 'None'], [20, 0]), isStuck: true };
        const node = { id: 'node', displayName: 'Node (Medium)', shape: 'Node1x2', color: 'White', effects: ['None', 'None'], effectValues: [0, 0] };
        const initial = board().map((row, y) => row.map((cell, x) => y < 2 && x < 2 ? stuck : y < 2 && x === 2 ? null : cell));
        const machine = { ...card(null, 4), sumPE: true,
            targetStats: { Performance: null, Quality: null, Efficiency: 19 },
            maximizeStats: { Performance: false, Quality: false, Efficiency: false },
            ignoreStats: { Performance: true, Quality: true, Efficiency: false },
        };
        const out = await solve(machine, [stuck, node], initial);
        assert.equal(out.board[0][0].id, 'stuck');
        assert.ok(out.board.flat().some(cell => cell && cell !== 'Locked' && cell.id === 'node'));
        const future = out.board.map(row => row.map(cell => cell && cell !== 'Locked' ? projectDegradation(cell, 4) : cell));
        const totals = calculateBoardStats(future, [projectDegradation(stuck, 4), node]).totals;
        assert.ok(totals.Performance + totals.Efficiency >= 19);
    });
    test('protected targets and typed custom targets are never silently relaxed', () => {
        const stepped = { ...card(15), targetSteps: { Performance: [10, 15, 20] } };
        assert.deepEqual(stallOrders([stepped], [[15, null, null]], [[false, false, false]], () => 0), []);
        const custom = { ...stepped, degradationDays: 0, targetStats: { ...stepped.targetStats, Performance: 17 } };
        assert.deepEqual(stallOrders([custom], [[17, null, null]], [[false, false, false]], () => 0), []);
    });
    test('stuck degrading modules remain in their original cells', async () => {
        const stuck = { ...item('stuck', 16, 0, ['Degrading', 'None'], [20, 0]), isStuck: true };
        const initial = board().map((row, y) => row.map((cell, x) => x < 2 && y < 2 ? stuck : cell));
        const out = await solve(card(15), [stuck, item('spare', 40, 0)], initial);
        assert.equal(out.board[0][0].id, 'stuck');
        assert.equal(out.board[1][1].id, 'stuck');
        assert.equal(out.totals.Performance, 20);
    });
} finally {
    test.after(async () => { await server.close(); });
}
