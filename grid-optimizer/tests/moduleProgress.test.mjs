import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { getModuleProgressMax } = await server.ssrLoadModule('/src/moduleProgress.ts');
const { applyInternalEffects } = await server.ssrLoadModule('/src/utils.ts');
const { generateCodeFromState, calculateBoardStats } = await server.ssrLoadModule('/src/hooks/useOptimizer.ts');
const { decodeSolution } = await server.ssrLoadModule('/src/solvers/razboy/solver/codec.ts');
const { projectDegradation, firstThresholdFailure } = await server.ssrLoadModule('/src/degradation.ts');
test.after(async () => { await server.close(); });

const redL3 = { shape: 'L3', color: 'Red', displayName: 'Performance Module' };
const yellowC5 = { shape: 'C5', color: 'Yellow', displayName: 'Refinement Module' };
const item = (effects, current, template = redL3) => ({
    ...template, id: 'current-module', effects,
    effectValues: effects.map(effect => effect === 'Degrading' || effect === 'Learning Algorithm' ? current : 0),
});
const boardWith = piece => {
    const board = Array.from({ length: 5 }, () => Array(7).fill(null));
    board[0][0] = board[1][0] = board[1][1] = piece;
    return board;
};
const maxStats = { Performance: true, Quality: false, Efficiency: false };
const targets = { Performance: null, Quality: null, Efficiency: null };

test('fresh progress caps ignore current stat corrections and saved base snapshots', () => {
    const corrected = {
        ...redL3, id: 'corrected', currentStats: { Performance: 67, Quality: 3, Efficiency: -22 },
        baseStats: { Performance: 200, Quality: 0, Efficiency: 0 },
        effects: ['Learning Algorithm', 'Receiver'], effectValues: [67, 0],
    };
    assert.equal(getModuleProgressMax(corrected, corrected.effects), 24);
    assert.equal(getModuleProgressMax(corrected, ['Negative Feedback', 'Degrading']), 30);
});

test('fresh L3 caps include both initialized effects with game rounding in their original slots', () => {
    for (const [effects, expected] of [
        [['Negative Feedback', 'Degrading'], 30], [['Degrading', 'Negative Feedback'], 30],
        [['Premium', 'Degrading'], 28], [['Degrading', 'Premium'], 28],
        [['Inferior', 'Degrading'], 18], [['Degrading', 'Inferior'], 19],
        [['Overcharged', 'Degrading'], 48], [['Degrading', 'Overcharged'], 48],
    ]) assert.equal(getModuleProgressMax(redL3, effects), expected, effects.join(' then '));
});

test('five-cell quality modules retain the one-point difference caused by slot-order rounding', () => {
    assert.equal(getModuleProgressMax(yellowC5, ['Negative Feedback', 'Degrading']), 76);
    assert.equal(getModuleProgressMax(yellowC5, ['Degrading', 'Negative Feedback']), 77);
});

test('manual current values are final readings rather than fresh initialization caps', () => {
    for (const effects of [['Negative Feedback', 'Degrading'], ['Degrading', 'Negative Feedback']]) {
        assert.equal(getModuleProgressMax(redL3, effects), 30);
        const current = item(effects, 27);
        assert.equal(applyInternalEffects(current).Performance, 27);
        // Imported/current values must not be clamped to the fresh cap either.
        assert.equal(applyInternalEffects(item(effects, 35)).Performance, 35);
        assert.equal(applyInternalEffects(item(effects, 0)).Performance, 0);
        assert.deepEqual(current.effectValues, effects.map(effect => effect === 'Degrading' ? 27 : 0));
    }
});

test('code export and compatible code import preserve current27 in either effect order', () => {
    // The shared solution format has an exported decoder in the Razboy backend;
    // exercise the real app encoder/decoder rather than a test copy of its bits.
    for (const effects of [['Negative Feedback', 'Degrading'], ['Degrading', 'Negative Feedback']]) {
        const original = item(effects, 27);
        const code = generateCodeFromState(3, maxStats, targets, [original], boardWith(original));
        assert.ok(code.length > 0);
        const decoded = decodeSolution(code);
        assert.equal(decoded.inventory.length, 1);
        const restored = decoded.inventory[0];
        assert.deepEqual(restored.effects, effects);
        assert.equal(restored.effectValues[effects.indexOf('Degrading')], 27);
        assert.equal(applyInternalEffects(restored).Performance, 27);
        assert.equal(calculateBoardStats(decoded.board, decoded.inventory).totals.Performance, 27);
        assert.equal(generateCodeFromState(decoded.tier, decoded.maximizeStats, decoded.targetStats, decoded.inventory, decoded.board), code);
        const next = projectDegradation(restored, 1);
        assert.equal(next.effectValues[effects.indexOf('Degrading')], 26);
        assert.equal(applyInternalEffects(next).Performance, 26);
        assert.equal(calculateBoardStats(decoded.board, [next]).totals.Performance, 26);
    }
});

test('forecast loses one current percentage point per use without repeating the other multiplier', () => {
    for (const effects of [['Negative Feedback', 'Degrading'], ['Degrading', 'Negative Feedback']]) {
        const current = item(effects, 27);
        const valueAt = uses => applyInternalEffects(projectDegradation(current, uses)).Performance;
        assert.deepEqual([0, 1, 2, 27, 28].map(valueAt), [27, 26, 25, 0, 0]);
        assert.equal(firstThresholdFailure(valueAt, 25, 27), 3);
        assert.equal(current.effectValues[effects.indexOf('Degrading')], 27);
    }
});

test('Learning still starts at zero with a fresh ceiling, without credited future learning gains', () => {
    assert.equal(getModuleProgressMax(redL3, ['Learning Algorithm', 'None']), 24);
    for (const placement of ['Receiver', 'Side Mount', 'Top Mount']) {
        for (const effects of [[placement, 'Learning Algorithm'], ['Learning Algorithm', placement]]) {
            assert.equal(getModuleProgressMax(redL3, effects), 24);
            const current = item(effects, 0);
            assert.equal(applyInternalEffects(current).Performance, 0);
            assert.equal(projectDegradation(current, 30), current);
        }
    }
});

test('receiver and mounts add no fresh initialization boost; nonprogress modules have no progress cap', () => {
    for (const placement of ['Receiver', 'Side Mount', 'Top Mount']) {
        assert.equal(getModuleProgressMax(redL3, ['Degrading', placement]), 24);
        assert.equal(getModuleProgressMax(redL3, [placement, 'Degrading']), 24);
    }
    assert.equal(getModuleProgressMax(redL3, ['Premium', 'Negative Feedback']), 0);
    assert.equal(getModuleProgressMax(redL3, []), 0);
    assert.equal(getModuleProgressMax({ shape: 'Node1x2', color: 'White', displayName: 'Node' }, ['Degrading', 'None']), 0);
});
