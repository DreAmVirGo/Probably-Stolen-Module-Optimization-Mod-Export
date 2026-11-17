import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import tgpu from 'typegpu';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const main = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const utils = await server.ssrLoadModule('/src/utils.ts');
const hoydoy = await server.ssrLoadModule('/src/solvers/hoydoy/engine.ts');
const razboy = await server.ssrLoadModule('/src/solvers/razboy/solver/boardStats.ts');
const { buildPoolTables } = await server.ssrLoadModule('/src/solvers/razboy/solver/tables.ts');
const { toIndexBoard } = await server.ssrLoadModule('/src/solvers/razboy/solver/indexBoard.ts');
const { boardTotals } = await server.ssrLoadModule('/src/solvers/razboy/solver/boardTotals.ts');
const { evalPlacement } = await server.ssrLoadModule('/src/solvers/razboy/solver/evalPlacement.ts');
const { buildScoringParams } = await server.ssrLoadModule('/src/solvers/razboy/solver/scoring.ts');
const geometry = await server.ssrLoadModule('/src/solvers/razboy/solver/geometry.ts');
const { projectDegradation } = await server.ssrLoadModule('/src/degradation.ts');
const item = (id, shape, color, effects = ['None', 'None'], effectValues = [0, 0]) => ({
    id, shape, color, displayName: color === 'Green' ? 'Efficiency' : color === 'Yellow' ? 'Refinement' : 'Overclock', effects, effectValues,
});
const nf = effects => item('nf', 'Square4_Base', 'Green', effects);
const refinement = item('refinement', 'C5', 'Yellow');
const overclock = item('overclock', 'P5', 'Red');
const empty = () => Array.from({ length: 5 }, () => Array(7).fill(null));
const put = (board, module, x, y) => {
    for (const offset of utils.PRECOMPUTED_OFFSETS.get(module.shape)[0]) board[y + offset.y][x + offset.x] = module;
};
const machine = {
    id: 'machine', tier: 3,
    targetStats: { Performance: null, Quality: null, Efficiency: null },
    maximizeStats: { Performance: false, Quality: false, Efficiency: true },
    ignoreStats: { Performance: true, Quality: true, Efficiency: false },
};

test.after(async () => { await server.close(); });

test('NF truncates absorbed negatives before adding its positive stat in every CPU board evaluator', () => {
    const feedback = nf(['Negative Feedback', 'None']);
    const board = empty();
    put(board, feedback, 0, 0);
    put(board, refinement, 2, 0);
    const inventory = [feedback, refinement];
    const expected = main.calculateBoardStats(board, inventory);
    // NF: 16 * 1.25 = 20; absorbed E: trunc(-18/4) = -4.
    // The refinement still has E -18, so the board's E is 16 -18 = -2.
    assert.equal(expected.pieceStats.get('nf').Efficiency, 16);
    assert.equal(expected.totals.Efficiency, -2);
    for (const evaluator of [hoydoy.calculateBoardStats, razboy.calculateBoardStats]) {
        const actual = evaluator(board, inventory);
        assert.deepEqual(actual.totals, expected.totals);
        assert.deepEqual(actual.pieceStats, expected.pieceStats);
    }
    const tables = buildPoolTables(inventory, [board]);
    const actual = { p: 0, q: 0, e: 0, pieces: 0 };
    boardTotals(tables, toIndexBoard(board, tables.indexOf), actual);
    assert.deepEqual([actual.p, actual.q, actual.e], Object.values(expected.totals));
});

test('full-board parity includes distinct-neighbour aggregation, mounts, repeated slots and projected values', () => {
    const variants = [
        nf(['Negative Feedback', 'None']),
        nf(['Negative Feedback', 'Side Mount']),
        nf(['Top Mount', 'Negative Feedback']),
        // Legacy solution codes can still carry both slots even though the builder does not offer this pair.
        nf(['Negative Feedback', 'Negative Feedback']),
        item('nf', 'Square4_Base', 'Green', ['Negative Feedback', 'Degrading'], [0, 20]),
    ];
    for (const candidate of variants) for (const day of [0, 4]) {
        const feedback = projectDegradation(candidate, day);
        const inventory = [feedback, refinement, overclock];
        const board = empty();
        put(board, feedback, 0, 0);
        put(board, refinement, 2, 0);
        put(board, overclock, 0, 2);
        const expected = main.calculateBoardStats(board, inventory);
        for (const evaluator of [hoydoy.calculateBoardStats, razboy.calculateBoardStats]) {
            const actual = evaluator(board, inventory);
            assert.deepEqual(actual.totals, expected.totals);
            assert.deepEqual(actual.pieceStats, expected.pieceStats);
        }
        const tables = buildPoolTables(inventory, [board]);
        const actual = { p: 0, q: 0, e: 0, pieces: 0 };
        boardTotals(tables, toIndexBoard(board, tables.indexOf), actual);
        assert.deepEqual([actual.p, actual.q, actual.e], Object.values(expected.totals));
    }
});

test('placement scorers preserve the same NF rounding as full-board totals', () => {
    const feedback = nf(['Negative Feedback', 'None']);
    const inventory = [feedback, refinement];
    const board = empty();
    put(board, refinement, 2, 0);
    const internal = new Map(inventory.map(module => [module.id, utils.applyInternalEffects(module)]));
    const orientation = utils.PRECOMPUTED_ORIENTATIONS.get(feedback.shape)[0];
    const score = main.evaluatePlacementDelta(main.buildPlacementContext(feedback, internal), 0, 0, orientation, board,
        false, internal, 0, 0, 1, 0, 0, -18, machine);
    assert.equal(score, 16);
    assert.equal(hoydoy.evaluatePlacementDelta(hoydoy.buildPlacementContext(feedback, internal), 0, 0, orientation, board,
        false, internal, 0, 0, 1, 0, 0, -18, machine), score);
    const tables = buildPoolTables(inventory, [board]);
    const indexed = toIndexBoard(board, tables.indexOf);
    let occupiedLo = 0, occupiedHi = 0;
    indexed.forEach((module, cell) => { if (module >= 0) { occupiedLo |= geometry.cellMaskLo(cell); occupiedHi |= geometry.cellMaskHi(cell); } });
    const entry = geometry.placeEntry(tables.orientStart[tables.indexOf.get('nf')], 0);
    const out = { ok: false, major: 0, minor: 0 };
    evalPlacement(tables, entry, tables.indexOf.get('nf'), indexed, occupiedLo, occupiedHi, false,
        buildScoringParams(machine, { Performance: 0, Quality: 0, Efficiency: 1 }), 0, 0, -18, out);
    assert.equal(out.ok, true);
    assert.equal(out.major, score);
});

test('GPU shader generation preserves separate truncation in both placement and full-board NF paths', async () => {
    const { createSearchKernel } = await server.ssrLoadModule('/src/solvers/razboy/solver/gpu/kernel.ts');
    const { prepareSolve } = await server.ssrLoadModule('/src/solvers/razboy/solver/setup.ts');
    const feedback = nf(['Negative Feedback', 'None']);
    const inventory = [feedback, refinement];
    const setup = prepareSolve({ machines: [{ machine, initialBoard: empty() }], searchPoolInventory: inventory, fullInventory: inventory });
    // TypeGPU buffers are lazy. Resolving WGSL needs the standard enum values,
    // but neither allocates GPU buffers nor requires an adapter on the test host.
    const previousUsage = globalThis.GPUBufferUsage;
    globalThis.GPUBufferUsage = { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
    try {
        const root = tgpu.initFromDevice({ device: { features: new Set(), limits: {} } });
        const kernel = createSearchKernel(root, setup, 123, 1);
        const code = tgpu.resolve([kernel.searchStep]);
        assert.ok(code.includes('@compute'));
        // Check the generated shader, where i32(f32(...)/4f) truncates the
        // absorbed contribution before the outer addition to the module stat.
        for (const [own, negative] of [['p', 'nfP'], ['q', 'nfQ'], ['e', 'nfE'], ['myP', 'nfPerf'], ['myQ', 'nfQual'], ['myE', 'nfEff']]) {
            assert.ok(code.includes(`${own} = (${own} + (nfCount * i32((f32(${negative}) / 4f))));`));
        }
    } finally {
        if (previousUsage === undefined) delete globalThis.GPUBufferUsage;
        else globalThis.GPUBufferUsage = previousUsage;
    }
});
