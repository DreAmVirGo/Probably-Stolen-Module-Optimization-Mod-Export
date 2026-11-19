import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { unlockedTaskProtectionUses, deriveTaskSafety } = await server.ssrLoadModule('/src/taskSafety.ts');
test.after(async () => { await server.close(); });

const stats = (Performance, Quality = Performance, Efficiency = Performance) => ({ Performance, Quality, Efficiency });
const job = extra => ({ active: true, kind: 'printer', current: 0, required: 96, importedDay: 20, ...extra });
const degrading = (id, value, extra = {}) => ({
    id, shape: 'L3', color: 'Red', displayName: 'Performance',
    effects: ['Degrading', 'None'], effectValues: [value, 0], ...extra,
});

test('an explicit minimum protects only remaining work rather than restarting the full job', () => {
    const running = job({ current: 72 });
    assert.deepEqual(unlockedTaskProtectionUses(running, 0, []), stats(0));
    assert.deepEqual(unlockedTaskProtectionUses(job(), 0, []), stats(3));
    assert.equal(running.current, 72);
});

test('the hard Performance minimum, rather than a fast initial layout, bounds an unlocked solve', () => {
    const running = job();
    assert.equal(deriveTaskSafety(running, 100).remainingDays, 2);
    assert.deepEqual(unlockedTaskProtectionUses(running, 0, []), stats(3), 'minimum24 work/day needs4 uses, not the initial48work/day');
    assert.deepEqual(unlockedTaskProtectionUses(running, 100, []), stats(1));
});

test('bounded task horizons retain the native per-stat sequence', () => {
    const desequencer = job({ kind: 'desequencer', current: 33, required: 99 });
    assert.deepEqual(unlockedTaskProtectionUses(desequencer, 0, []), stats(2, 1, 1));
    const hydroponic = job({ kind: 'hydroponic', current: 8, required: 24 });
    assert.deepEqual(unlockedTaskProtectionUses(hydroponic, 0, []), stats(1));
});

test('Auto Performance uses full wear even beyond365 uses and ignores unrelated stable items', () => {
    const inventory = [
        degrading('ordinary', 500),
        degrading('snapshot', 25, { currentStats: stats(900, 0, -8) }),
        degrading('stable', 2000, { effects: ['None', 'None'] }),
    ];
    assert.deepEqual(unlockedTaskProtectionUses(job(), null, inventory), stats(900));
    assert.equal(inventory[1].currentStats.Performance, 900);
});

test('full wear honors edited snapshot positives and repeated Degrading consumption', () => {
    const duplicate = degrading('duplicate', 25, { effects: ['Degrading', 'Degrading'], effectValues: [25, 25], currentStats: stats(1001, 3, -18) });
    assert.deepEqual(unlockedTaskProtectionUses(job(), null, [duplicate]), stats(501));
});

test('a blocked or too-long hard minimum falls back to complete wear, without a365-use clamp', () => {
    const inventory = [degrading('longwear', 700)];
    assert.deepEqual(unlockedTaskProtectionUses(job(), -100, inventory), stats(700));
    assert.equal(deriveTaskSafety(job({ required: 10_000 }), 0).remainingDays, null);
    assert.deepEqual(unlockedTaskProtectionUses(job({ required: 10_000 }), 0, inventory), stats(700));
    for (const invalid of [NaN, Infinity, -Infinity]) assert.deepEqual(unlockedTaskProtectionUses(job(), invalid, inventory), stats(700));
});

test('stable inventory yields an explicit zero map in the full-wear fallback', () => {
    const stable = degrading('stable', 900, { effects: ['Learning Algorithm', 'None'] });
    assert.deepEqual(unlockedTaskProtectionUses(job(), null, [stable]), stats(0));
    assert.deepEqual(unlockedTaskProtectionUses(job(), -100, []), stats(0));
});
