import assert from 'node:assert/strict';
import test from 'node:test';
import { readRunningJob, readStoredRunningJob, runningJobKey, writeImportedRunningJob } from '../src/runningJobs.ts';

const keys = ['PROGRESS_TYPE_MACHINE_TAG', 'MACHINE_STATE_TAG', 'MACHINE_PROGRESS_CURRENT_TAG', 'MACHINE_PROGRESS_TARGET_TAG'];
const machine = (state = 'STATE_WORKING', current = 10, required = 50) => ({
    uniqueId: 700,
    _keys: [...keys],
    _values: [{ valueEnabled: true }, { valueEnabled: true, internalValueString: state }, { valueInt: current }, { valueInt: required }],
});
const detect = raw => readRunningJob('Hydroponic System', raw, 42, 'seed:coffee:50:8');
const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
test.beforeEach(() => storage.clear());

test('recognizes unfinished native working jobs for each supported progress machine', () => {
    for (const [name, kind] of [['Hydroponic System', 'hydroponic'], ['3D Printer', 'printer'], ['DNA Manipulator', 'dna'], ['Cryptographic Desequencer', 'desequencer']]) {
        assert.deepEqual(readRunningJob(name, machine(), 42, 'selected-job'), {
            active: true, kind, current: 10, required: 50, importedDay: 42, jobKey: 'selected-job', sourceUid: 700,
        });
    }
    assert.equal(readRunningJob('Furnace', machine(), 42), null);
    assert.equal(readRunningJob('', { ...machine(), identifier: 'plant_dna_manipulator' }, 42).kind, 'dna');
});

test('input presence and child growth counters alone never prove that a machine has started', () => {
    const raw = {
        childItems: [123],
        children: [{ identifier: 'coffee_bean', _keys: ['GROWING_TAG', 'GROWING_PROGRESS', 'REQUIRED_PROGRESS'], _values: [{ valueEnabled: true }, { valueInt: 1 }, { valueInt: 50 }] }],
        _keys: ['GROWING_TAG', 'GROWING_PROGRESS', 'REQUIRED_PROGRESS', 'PROGRESS_ITEM_TARGET_TAG'],
        _values: [{ valueEnabled: true }, { valueInt: 1 }, { valueInt: 50 }, { valueInt: 50 }],
    };
    assert.equal(detect(raw), null);
    assert.equal(readRunningJob('3D Printer', raw, 42, 'chip:50:0:test'), null);
    assert.equal(detect(machine('STATE_READY')), null);
    assert.equal(detect(machine('STATE_IDLE')), null);
    assert.equal(detect(machine('STATE_COMPLETED')), null);
});

test('a just-started working job can have zero progress, while completed or invalid counters do not lock', () => {
    assert.equal(detect(machine('STATE_WORKING', 0, 50)).current, 0);
    for (const [current, required] of [[50, 50], [51, 50], [-1, 50], [0, 0], [0, -1], [NaN, 50], [0, Infinity], ['10', 50], [0, '50'], [null, 50]]) {
        assert.equal(detect(machine('STATE_WORKING', current, required)), null, `${current}/${required}`);
    }
});

test('disabled or missing native tags leave the running state unknown instead of auto-locking', () => {
    for (let index = 0; index < keys.length; index++) {
        const disabled = machine();
        disabled._values[index].valueEnabled = false;
        assert.equal(detect(disabled), null, `disabled ${keys[index]}`);
        const missing = machine();
        missing._keys.splice(index, 1);
        missing._values.splice(index, 1);
        assert.equal(detect(missing), null, `missing ${keys[index]}`);
    }
    const noStateValue = machine();
    delete noStateValue._values[1].internalValueString;
    assert.equal(detect(noStateValue), null);
    assert.equal(detect(machine('state_working')), null);
});

test('supports tagged value objects without relying on parallel array indexes', () => {
    const raw = machine();
    raw._values = raw._values.map((value, index) => ({ ...value, '<identifier>k__BackingField': keys[index] }));
    delete raw._keys;
    assert.equal(detect(raw).current, 10);
    raw._values[0].valueEnabled = false;
    assert.equal(detect(raw), null);
});

test('save-day and machine-uid metadata are validated without guessing job state from them', () => {
    const running = readRunningJob('Hydroponic System', { ...machine(), uniqueId: '700' }, null);
    assert.equal(running.active, true);
    assert.equal(running.importedDay, null);
    assert.equal(running.sourceUid, undefined);
    assert.equal(readRunningJob('Hydroponic System', machine(), -1).importedDay, null);
    assert.equal(readRunningJob('Hydroponic System', machine(), 0).importedDay, 0);
    assert.equal(readRunningJob('Hydroponic System', machine('STATE_READY'), 999), null);
});

test('fresh import replaces cached job progress, and an idle or completed import clears the derived lock', () => {
    const first = detect(machine());
    writeImportedRunningJob('m', first);
    assert.deepEqual(readStoredRunningJob('m'), first);
    const next = detect(machine('STATE_WORKING', 30, 50));
    writeImportedRunningJob('m', next);
    assert.equal(readStoredRunningJob('m').current, 30);
    writeImportedRunningJob('m', detect(machine('STATE_WORKING', 50, 50)));
    assert.equal(localStorage.getItem(runningJobKey('m')), null);
    assert.equal(readStoredRunningJob('m'), null);
    writeImportedRunningJob('m', first);
    writeImportedRunningJob('m', detect(machine('STATE_READY')));
    assert.equal(readStoredRunningJob('m'), null);
    writeImportedRunningJob('m', first);
    writeImportedRunningJob('m', undefined);
    assert.equal(readStoredRunningJob('m'), null);
});

test('corrupt, inactive, complete or unknown cached records cannot create an automatic lock', () => {
    const valid = detect(machine());
    for (const value of [null, {}, { ...valid, active: false }, { ...valid, kind: 'unknown' }, { ...valid, current: 50 }, { ...valid, required: 0 }, { ...valid, current: '10' }]) {
        localStorage.setItem(runningJobKey('m'), JSON.stringify(value));
        assert.equal(readStoredRunningJob('m'), null);
    }
    localStorage.setItem(runningJobKey('m'), '{broken');
    assert.equal(readStoredRunningJob('m'), null);
});
