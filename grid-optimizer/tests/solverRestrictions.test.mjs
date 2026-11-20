import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { runOptimizationEngine } = await server.ssrLoadModule('/src/solver/engine.ts');
const { calculateBoardStats, buildSearchPool } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { applyInternalEffects } = await server.ssrLoadModule('/src/utils.ts');
const { allowsModuleEffects } = await server.ssrLoadModule('/src/moduleRestrictions.ts');
test.after(async () => { await server.close(); });

const mod = (id, effects = ['None', 'None'], extra = {}) => ({
    id, shape: 'Square4_Base', color: 'Red', displayName: 'Performance', effects, effectValues: [0, 0], ...extra,
});
const plain = mod('plain');
const premium = mod('premium', ['Premium', 'None']);
const config = (id, forbiddenEffects = [], extra = {}) => ({
    id, tier: 3, forbiddenEffects,
    targetStats: { Performance: null, Quality: null, Efficiency: null },
    maximizeStats: { Performance: true, Quality: false, Efficiency: false },
    ignoreStats: { Performance: false, Quality: true, Efficiency: true }, ...extra,
});
const board = (width = 2, height = 2) => Array.from({ length: 5 }, (_, y) => Array.from({ length: 7 }, (_, x) => x < width && y < height ? null : 'Locked'));
const put = (value, item, x = 0, y = 0) => { value[y][x] = value[y][x + 1] = value[y + 1][x] = value[y + 1][x + 1] = item; return value; };
const ids = value => new Set(value.flat().filter(item => item && item !== 'Locked').map(item => item.id));
const cellsOf = (value, id) => value.flat().flatMap((cell, index) => cell && cell !== 'Locked' && cell.id === id ? [index] : []);
async function solve(machines, inventory, initial, { checks = 1800, tuning = {}, pool = inventory } = {}) {
    let seen = 0, randomState = 12345, last = new Map(), reports = 0;
    const random = Math.random;
    Math.random = () => ((randomState = (1664525 * randomState + 1013904223) >>> 0) / 0x100000000);
    try {
        await runOptimizationEngine(machines, initial, pool, inventory,
            { get current() { return ++seen < checks; } }, updates => {
                reports++;
                last = updates;
                for (const machine of machines) {
                    const update = updates.get(machine.id);
                    assert.ok(update);
                    for (const cell of update.board.flat()) {
                        if (!cell || cell === 'Locked' || allowsModuleEffects(cell, machine.forbiddenEffects)) continue;
                        const canonical = inventory.find(item => item.id === cell.id) ?? cell;
                        assert.ok(cell.isLocked || cell.isStuck || canonical.isLocked || canonical.isStuck,
                            `${cell.id} was forbidden on ${machine.id}`);
                        assert.deepEqual(cellsOf(update.board, cell.id), cellsOf(initial[machines.indexOf(machine)], cell.id),
                            'a forbidden pinned resident must retain its exact cells');
                    }
                }
            }, { stall: 0, stage: 0, ...tuning });
    } finally { Math.random = random; }
    return { reports, updates: last, boards: machines.map((machine, index) => last.get(machine.id)?.board ?? initial[index]) };
}

test('initial forbidden movable residents are removed and reported even without a new search record', async () => {
    const initial = put(board(), premium);
    const result = await solve([config('restricted', ['Premium'])], [premium], [initial], { checks: 0 });
    assert.equal(result.reports, 1);
    assert.equal(ids(result.boards[0]).size, 0);
    assert.equal(ids(initial).has('premium'), true, 'initial caller board is not mutated');
    assert.equal(premium.effects[0], 'Premium');
});

test('freed banned modules remain available to another eligible machine', async () => {
    const machines = [config('restricted', ['Premium']), config('permissive')];
    const initial = [put(board(), premium), board()];
    const result = await solve(machines, [premium, plain], initial);
    assert.equal(ids(result.boards[0]).has('premium'), false);
    assert.equal(ids(result.boards[0]).has('plain'), true);
    assert.equal(ids(result.boards[1]).has('premium'), true);
});

test('Degrading and Overcharged presets check both effect slots independently and together', async () => {
    const degrading = mod('degrading', ['None', 'Degrading'], { effectValues: [0, 32] });
    const overcharged = mod('overcharged', ['Overcharged', 'None']);
    const inventory = [plain, premium, degrading, overcharged];
    for (const forbidden of [['Degrading'], ['Overcharged'], ['Degrading', 'Overcharged']]) {
        const machines = [config('restricted', forbidden), config('permissive')];
        const result = await solve(machines, inventory, [board(), board()]);
        const own = result.boards[0][0][0];
        assert.ok(own);
        assert.ok(allowsModuleEffects(own, forbidden));
        assert.equal(own.id, forbidden.length === 2 ? 'premium' : forbidden[0] === 'Degrading' ? 'overcharged' : 'degrading');
        assert.ok(ids(result.boards[1]).has('degrading') || ids(result.boards[1]).has('overcharged'));
    }
});

test('stronger forbidden effects cannot prune the plain candidates a restricted card needs', async () => {
    const premiums = Array.from({ length: 50 }, (_, index) => mod(`premium${index}`, ['Premium', 'None']));
    const inventory = [...premiums, plain];
    const machines = [config('restricted', ['Premium']), config('permissive')];
    const internal = new Map(inventory.map(item => [item.id, applyInternalEffects(item)]));
    assert.ok(buildSearchPool(inventory, internal, machines).some(item => item.id === 'plain'));
    const result = await solve(machines, inventory, [board(), board()]);
    assert.equal(ids(result.boards[0]).has('plain'), true);
    assert.equal(result.boards[1][0][0].effects[0], 'Premium');
});

test('forbidden locked, stuck and effectively locked residents retain their original positions', async () => {
    for (const kind of ['locked', 'stuck', 'effective-lock']) {
        const pinned = mod(`pinned-${kind}`, ['Premium', 'None'], kind === 'stuck' ? { isStuck: true } : { isLocked: true });
        const resident = kind === 'effective-lock' ? { ...pinned, isLocked: false } : pinned;
        const initial = put(board(7, 5), resident, 3, 2);
        const result = await solve([config('restricted', ['Premium'])], [pinned, plain], [initial], {
            checks: 4000, tuning: { repackOneIn: 1, swapOneIn: 1, relayoutOneIn: 1, windowOneIn: 1, stagnationLimit: 5 },
        });
        assert.deepEqual(cellsOf(result.boards[0], pinned.id), [17, 18, 24, 25]);
    }
});

test('same-shaped swaps and cross-machine draws cannot bring a forbidden module into a priority card', async () => {
    const machines = [config('restricted', ['Premium'], { statPriority: { Performance: 1 } }), config('permissive', [], { statPriority: { Performance: 2 } })];
    const initial = [put(board(), plain), put(board(), premium)];
    const result = await solve(machines, [plain, premium], initial, { checks: 4000, tuning: { swapOneIn: 1, polish: 1 } });
    assert.equal(ids(result.boards[0]).has('premium'), false);
    assert.equal(ids(result.boards[1]).has('premium'), true);
});

test('report ordering never treats cards with different effect restrictions as interchangeable', async () => {
    const learner = mod('learner', ['Learning Algorithm', 'None']);
    const machines = [config('restricted', ['Premium']), config('permissive')];
    const initial = [put(board(), plain), put(board(), premium)];
    const result = await solve(machines, [plain, premium, learner], initial, { checks: 0 });
    assert.equal(result.reports, 1, 'a spare learner forces the initial report path');
    assert.equal(ids(result.boards[0]).has('plain'), true);
    assert.equal(ids(result.boards[1]).has('premium'), true);
});

test('cleanup replacements and target polishing reject forbidden incoming modules', async () => {
    const weakPremium = mod('weak-premium', ['Premium', 'None'], { currentStats: { Performance: 10, Quality: 0, Efficiency: 0 } });
    const target = { Performance: 8, Quality: null, Efficiency: null };
    const machine = config('restricted', ['Premium'], { targetStats: target, maximizeStats: { Performance: false, Quality: false, Efficiency: false } });
    const cleaned = await solve([machine], [plain, weakPremium], [put(board(), plain)], { checks: 0 });
    assert.equal(ids(cleaned.boards[0]).has('weak-premium'), false);
    const unreachable = config('restricted', ['Premium'], { targetStats: { Performance: 18, Quality: null, Efficiency: null },
        maximizeStats: { Performance: false, Quality: false, Efficiency: false } });
    const polished = await solve([unreachable], [plain, premium], [put(board(), plain)], { checks: 8000, tuning: { polish: 1, swapOneIn: 0, windowOneIn: 0 } });
    assert.equal(ids(polished.boards[0]).has('premium'), false);
    assert.equal(calculateBoardStats(polished.boards[0], [plain, premium]).totals.Performance, 16);
});

test('Learning filler observes destination restrictions instead of globally dropping training modules', async () => {
    const learner = mod('learner', ['Learning Algorithm', 'None']);
    const machines = [config('no-learning', ['Learning Algorithm']), config('training')];
    const result = await solve(machines, [learner], [board(), board()], { checks: 0 });
    assert.equal(ids(result.boards[0]).has('learner'), false);
    assert.equal(ids(result.boards[1]).has('learner'), true);
});

test('restricted water searches keep invariants through window repacking and relayout', async () => {
    const inventory = [plain, premium,
        mod('quality', ['None', 'None'], { color: 'Yellow', displayName: 'Quality' }),
        mod('quality-premium', ['Premium', 'None'], { color: 'Yellow', displayName: 'Quality' }),
        mod('learning', ['Learning Algorithm', 'None'])];
    const water = { water: true, maximizeStats: { Performance: true, Quality: true, Efficiency: false }, ignoreStats: { Performance: false, Quality: false, Efficiency: true } };
    const machines = [config('restricted', ['Premium'], water), config('permissive', [], water)];
    const result = await solve(machines, inventory, [put(board(4, 4), plain), put(board(4, 4), premium)], {
        checks: 8000, tuning: { swapOneIn: 2, windowOneIn: 1, relayoutOneIn: 1, repackOneIn: 1, polish: 1, stagnationLimit: 8 },
    });
    assert.ok(result.reports > 0);
    assert.ok([...ids(result.boards[0])].every(id => !inventory.find(item => item.id === id).effects.includes('Premium')));
});
