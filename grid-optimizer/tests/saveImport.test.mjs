import assert from 'node:assert/strict';
import test from 'node:test';
import { getSaveItemName, readSaveDay, readSaveInventory } from '../src/saveImport.ts';

const inventorySave = items => JSON.stringify({ mainInvJSON: JSON.stringify({ saveItems: items }) });

test('reads the displayed station day without adding an offset', () => {
    for (const day of [0, 1, 27, 365]) {
        assert.equal(readSaveDay(JSON.stringify({ storeStation: { value: { dayCounter: day } } })), day);
    }
});

test('reads station day even when ES3 dictionaries prevent whole-file JSON parsing', () => {
    const text = '{"playerStore":{"value":{"dictionary":{1:"one",2:"two"}}},"storeStation":{"__type":"StoreStation, Assembly-CSharp","value":{"dayCounter":42,"data":{3:4}}}}';
    assert.throws(() => JSON.parse(text));
    assert.equal(readSaveDay(text), 42);
});

test('ignores inventory strings, nested counters and previews from other slots', () => {
    const text = JSON.stringify({
        mainInvJSON: JSON.stringify({ storeStation: { value: { dayCounter: 999 } }, saveItems: [] }),
        previews: [{ storeStation: { value: { dayCounter: 888 } } }],
        storeStation: { nested: { value: { dayCounter: 777 } }, value: { nested: { dayCounter: 666 }, dayCounter: 27 } },
    });
    assert.equal(readSaveDay(text), 27);
});

test('missing or invalid day counters remain unknown rather than guessing', () => {
    for (const day of [-1, 1.5, '27', null, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(readSaveDay(JSON.stringify({ storeStation: { value: { dayCounter: day } } })), null);
    }
    for (const text of ['', '{}', '{"dayCounter":27}', '{"storeStation":{"dayCounter":27}}', '{"storeStation":{"value":{"dayCounter":27']) {
        assert.equal(readSaveDay(text), null);
    }
});

test('reads standard nested inventory JSON without changing names or escapes', () => {
    const items = [{ name: '“泥炭”合成肉', note: 'C:\\games\\“quoted”\n"text"', uniqueId: 42 }];
    assert.deepEqual(readSaveInventory(inventorySave(items), 'mainInvJSON'), items);
});

test('reads the Chinese save escape pattern at the outer JSON layer', () => {
    const items = [{ name: '“泥炭”合成肉', uniqueId: 42 }];
    const text = inventorySave(items).replace(/[“”]/g, quote => '\\' + quote);
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), items);
});

test('reads escaped typographic quotes inside the inventory JSON as well', () => {
    const text = JSON.stringify({ mainInvJSON: '{"saveItems":[{"name":"\\“test\\”"}]}' });
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), [{ name: '“test”' }]);
});

test('preserves valid literal backslashes when a different quote needs repair', () => {
    const items = [{ name: '“test”', literal: '\\“' }];
    const text = inventorySave(items).replace('“test', '\\“test');
    assert.deepEqual(readSaveInventory(text, 'mainInvJSON'), items);
});

test('does not accept unrelated malformed or truncated JSON', () => {
    assert.throws(() => readSaveInventory('{"mainInvJSON":"\\x"}', 'mainInvJSON'));
    assert.throws(() => readSaveInventory('{"mainInvJSON":"unfinished', 'mainInvJSON'));
    assert.equal(readSaveInventory('{}', 'mainInvJSON'), null);
});

test('identifies localized machines and modules without changing their names', () => {
    const item = { identifier: 'moisture_farm', name: '水分收集器' };
    assert.equal(getSaveItemName(item), 'Moisture Farm');
    assert.equal(item.name, '水分收集器');
    assert.equal(getSaveItemName({ identifier: 'wine_rack', name: '催陈器' }), 'AgeWell');
    assert.equal(getSaveItemName({ identifier: 'system_module_fineness', name: '精炼模组' }), 'Refinement Module');
    assert.equal(getSaveItemName({ identifier: 'system_module_efficiancy', name: '效率模组' }), 'Efficiency Module');
    assert.equal(getSaveItemName({ identifier: 'node_medium', name: '节点（中）' }), 'Node (Medium)');
    assert.equal(getSaveItemName({ identifier: 'alarm_module_transmitter', name: '警报传输模组' }), 'Alarm Transmitter Module');
    assert.equal(getSaveItemName({ name: 'Neural Core Module (Capped)' }), 'Neural Core Module (Capped)');
    assert.equal(getSaveItemName({ identifier: 'unknown', name: 'Unknown item' }), 'Unknown item');
});
