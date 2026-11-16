import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
    resolve(specifier, context, nextResolve) {
        return nextResolve(specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) ? `${specifier}.ts` : specifier, context);
    },
});
const { statUnit } = await import('../src/machineDefaults.ts');
const { parseTargetValue } = await import('../src/targetValue.ts');
const totals = { Performance: 0, Quality: 0, Efficiency: 0 };

test('keeps custom percentages and rounds fractional minima upward within the export range', () => {
    assert.deepEqual(parseTargetValue('137', null, totals), { value: 137 });
    assert.deepEqual(parseTargetValue('137.1', null, totals), { value: 138 });
    assert.deepEqual(parseTargetValue('-12.8', null, totals), { value: -12 });
    for (const text of ['2048', '-2049', '1e99', 'Infinity', 'NaN']) assert.ok(parseTargetValue(text, null, totals).error);
});

test('converts work per day at its real integer threshold without silently capping large requests', () => {
    const unit = statUnit('Hydroponic System', 'Performance');
    assert.deepEqual(parseTargetValue('20', unit, totals), { value: 300 });
    assert.equal(unit.toPercent(1000), 24800);
    assert.ok(parseTargetValue('1000', unit, totals).error);
    assert.ok(parseTargetValue('-1', unit, totals).error);
});

test('rejects impossible energy ceilings and quality or alarm targets beyond game caps', () => {
    assert.deepEqual(parseTargetValue('4', statUnit('Furnace', 'Efficiency'), totals), { value: 50 });
    for (const value of ['0', '-1']) assert.ok(parseTargetValue(value, statUnit('Furnace', 'Efficiency'), totals).error);
    assert.ok(parseTargetValue('101', statUnit('Evaporator', 'Quality'), totals).error);
    assert.ok(parseTargetValue('101', statUnit('Alarm System', 'Performance'), totals).error);
    assert.deepEqual(parseTargetValue('100', statUnit('Alarm System', 'Performance'), totals), { value: 49 });
});

test('fractional displayed targets choose a whole game value that reaches the requested minimum', () => {
    const unit = statUnit('3D Printer', 'Quality');
    assert.deepEqual(parseTargetValue('33.5', unit, totals), { value: 136 });
    assert.equal(unit.fromPercent(136), 34);
    // Conversions that still miss the entered threshold must never be accepted.
    assert.ok(parseTargetValue('11', { unit: '%', step: 1, fromPercent: () => 10, toPercent: () => 10 }, totals).error);
});
