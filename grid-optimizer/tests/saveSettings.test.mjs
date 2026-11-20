import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The app uses bundler-style extensionless imports; let Node run the same TypeScript modules.
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
            return nextResolve(`${specifier}.ts`, context);
        }
        return nextResolve(specifier, context);
    },
});
const { restoreSaveSettings, flushSaveSettings, machineWatchKey, readMachineWatched } = await import('../src/saveSettings.ts');
const { machineRestrictionsKey, readForbiddenEffects } = await import('../src/moduleRestrictions.ts');

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
const get = key => JSON.parse(localStorage.getItem(key));
const machine = (id, uid, machineType) => ({ id, uid, machineType, tier: 3, boardIds: [[null]] });
const defaults = m => ({ tier: m.tier, boardIds: m.boardIds, targetStats: { Quality: null } });
const restore = (machines, save = 'save_1') => restoreSaveSettings(save, machines, defaults, [], () => {});
const loadCurrent = (machines, save = 'save_1') => {
    localStorage.setItem('optimizer_save_name', save);
    localStorage.setItem('optimizer_machine_list', JSON.stringify(machines.map(({ id }) => ({ id }))));
    for (const m of machines) localStorage.setItem(`optimizer_machine_type_${m.id}`, m.machineType);
};
test.beforeEach(() => storage.clear());

test('keeps the current order after moved or renumbered machines are imported, appending new machines', () => {
    const a = machine('a', 11, 'Inv. > Bay 1 > Furnace 1');
    const b = machine('b', 22, 'Inv. > Bay 1 > Furnace 2');
    restore([a, b]);
    loadCurrent([b, a]);
    localStorage.setItem('optimizer_machine_b', JSON.stringify({ ...defaults(b), targetStats: { Quality: 350 } }));
    // No debounce is pending: importing must still snapshot the current card order.
    flushSaveSettings();
    const incoming = [
        machine('a2', 11, 'Inv. > Bay 3 > Furnace 2'),
        machine('new', 33, 'Inv. > Bay 1 > Furnace 2'),
        machine('b2', 22, 'Inv. > Bay 3 > Furnace 1'),
    ];
    const sorted = restore(incoming);
    assert.deepEqual(sorted.map(m => m.uid), [22, 11, 33]);
    assert.equal(get('optimizer_machine_b2').targetStats.Quality, 350);
    assert.equal(get('optimizer_machine_new').targetStats.Quality, null);
});

test('preserves legacy path settings and migrates them to stable uid identity', () => {
    const path = 'Inv. > Furnace 1';
    localStorage.setItem('optimizer_save_settings_save_1', JSON.stringify({
        order: [`${path}#0`],
        machines: { [`${path}#0`]: { state: { targetStats: { Quality: 250 } } } },
    }));
    const imported = machine('migrated', 44, path);
    restore([imported]);
    assert.equal(get('optimizer_machine_migrated').targetStats.Quality, 250);
    loadCurrent([imported]);
    flushSaveSettings();
    const next = machine('moved', 44, 'Inv. > Expanded Bay > Furnace 5');
    restore([next]);
    assert.equal(get('optimizer_machine_moved').targetStats.Quality, 250);
    assert.deepEqual(get('optimizer_save_settings_save_1').order, ['uid:44']);
});

test('a new machine reusing an old path does not inherit the previous uid settings', () => {
    const path = 'Inv. > Furnace 1';
    const old = machine('old', 11, path);
    restore([old]);
    loadCurrent([old]);
    localStorage.setItem('optimizer_machine_old', JSON.stringify({ ...defaults(old), targetStats: { Quality: 999 } }));
    flushSaveSettings();
    restore([machine('new', 12, path)]);
    assert.equal(get('optimizer_machine_new').targetStats.Quality, null);
});

test('machines without uids retain occurrence identity through a reorder and reimport', () => {
    const a = machine('a', undefined, 'Inv. > Furnace');
    const b = machine('b', undefined, 'Inv. > Furnace');
    restore([a, b]);
    loadCurrent([b, a]);
    localStorage.setItem('optimizer_machine_b', JSON.stringify({ ...defaults(b), targetStats: { Quality: 123 } }));
    flushSaveSettings();
    const next = restore([machine('a2', undefined, a.machineType), machine('b2', undefined, b.machineType)]);
    assert.deepEqual(next.map(m => m.id), ['b2', 'a2']);
    assert.equal(get('optimizer_machine_b2').targetStats.Quality, 123);
});

test('keeps each save order separate and remembers the degradation horizon', () => {
    const a = machine('a', 1, 'Inv. > A');
    const b = machine('b', 2, 'Inv. > B');
    restore([a, b]);
    loadCurrent([b, a]);
    localStorage.setItem('optimizer_degradation_days_b', '4');
    flushSaveSettings();
    const other = restore([machine('otherA', 1, 'Inv. > A'), machine('otherB', 2, 'Inv. > B')], 'save_2');
    assert.deepEqual(other.map(m => m.uid), [1, 2]);
    const returned = restore([machine('backA', 1, 'Inv. > A'), machine('backB', 2, 'Inv. > B')]);
    assert.deepEqual(returned.map(m => m.uid), [2, 1]);
    assert.equal(localStorage.getItem('optimizer_degradation_days_backB'), '4');
});

test('fresh save boards and tiers win while remembered settings and module locks survive', () => {
    const old = machine('old', 1, 'Inv. > A');
    old.boardIds = [['mod']];
    restoreSaveSettings('save_1', [old], defaults, [{ id: 'mod', uid: 9 }], () => {});
    loadCurrent([old]);
    localStorage.setItem('optimizer_inventory', JSON.stringify([{ id: 'mod', uid: 9, isLocked: true }]));
    localStorage.setItem('optimizer_degradation_days_old', '2');
    flushSaveSettings();
    const fresh = machine('fresh', 1, 'Inv. > A');
    fresh.tier = 2;
    fresh.boardIds = [['mod2', null]];
    let locks;
    restoreSaveSettings('save_1', [fresh], defaults, [{ id: 'mod2', uid: 9 }], values => { locks = values; });
    assert.equal(get('optimizer_machine_fresh').tier, 2);
    assert.deepEqual(get('optimizer_machine_fresh').boardIds, [['mod2', null]]);
    assert.equal(locks.get('mod2'), true);
    assert.equal(localStorage.getItem('optimizer_degradation_days_fresh'), '2');
});

test('day backups and renamed downloads use the latest order and settings for the same save slot', () => {
    const a = machine('a', 11, 'Inv. > Furnace 1');
    const b = machine('b', 22, 'Inv. > Furnace 2');
    restore([a, b], 'save_14');
    loadCurrent([b, a], 'save_14');
    localStorage.setItem('optimizer_save_slot', '14');
    localStorage.setItem('optimizer_machine_b', JSON.stringify({ ...defaults(b), targetStats: { Quality: 350 } }));
    flushSaveSettings();
    const backupName = 'save_14_day25_20261116-210000';
    const incoming = [machine('a2', 11, a.machineType), machine('new', 33, 'Inv. > Furnace 3'), machine('b2', 22, b.machineType)];
    const backup = restoreSaveSettings(backupName, incoming, defaults, [], () => {}, 14);
    assert.deepEqual(backup.map(m => m.uid), [22, 11, 33]);
    assert.equal(get('optimizer_machine_b2').targetStats.Quality, 350);
    loadCurrent([incoming[0], incoming[1], incoming[2]], backupName);
    flushSaveSettings();
    // The old filename's snapshot is now older than the backup's slot snapshot.
    for (const name of ['save_14', 'save_14 (1)', 'my renamed save']) {
        const next = incoming.map(m => ({ ...m, id: `${name}_${m.id}` }));
        assert.deepEqual(restoreSaveSettings(name, next, defaults, [], () => {}, 14).map(m => m.uid), [11, 33, 22]);
    }
});

test('slot aliases isolate different game slots even when their machine uids overlap', () => {
    const a = machine('a', 11, 'Inv. > Furnace 1');
    const b = machine('b', 22, 'Inv. > Furnace 2');
    restore([a, b]);
    loadCurrent([b, a], 'save_14');
    localStorage.setItem('optimizer_save_slot', '14');
    localStorage.setItem('optimizer_degradation_days_b', '4');
    flushSaveSettings();
    const other = [machine('otherA', 11, a.machineType), machine('otherB', 22, b.machineType)];
    assert.deepEqual(restoreSaveSettings('renamed slot 15', other, defaults, [], () => {}, 15).map(m => m.uid), [11, 22]);
    assert.equal(localStorage.getItem('optimizer_degradation_days_otherB'), null);
    loadCurrent(other, 'renamed slot 15');
    localStorage.setItem('optimizer_save_slot', '15');
    flushSaveSettings();
    const back = [machine('backA', 11, a.machineType), machine('backB', 22, b.machineType)];
    assert.deepEqual(restoreSaveSettings('slot 14 backup', back, defaults, [], () => {}, 14).map(m => m.uid), [22, 11]);
    assert.equal(localStorage.getItem('optimizer_degradation_days_backB'), '4');
});


test('watched choices follow stable machine uids through reordering and same-slot day backups', () => {
    const a = machine('a', 11, 'Inv. > Furnace 1');
    const b = machine('b', 22, 'Inv. > Furnace 2');
    restore([a, b], 'save_14');
    loadCurrent([b, a], 'save_14');
    localStorage.setItem('optimizer_save_slot', '14');
    localStorage.setItem(machineWatchKey(a.id), 'false');
    // Checked is normally represented by no key, and must remain the default.
    assert.equal(readMachineWatched(b.id), true);
    flushSaveSettings();
    const incoming = [machine('a2', 11, 'Inv. > New Bay > Furnace 2'), machine('new', 33, 'Inv. > Furnace 3'), machine('b2', 22, 'Inv. > New Bay > Furnace 1')];
    const sorted = restoreSaveSettings('save_14_day42_20261119-120000', incoming, defaults, [], () => {}, 14);
    assert.deepEqual(sorted.map(m => m.uid), [22, 11, 33]);
    assert.equal(readMachineWatched('a2'), false);
    assert.equal(localStorage.getItem(machineWatchKey('a2')), 'false');
    assert.equal(readMachineWatched('b2'), true);
    assert.equal(readMachineWatched('new'), true);
    // The same uid in another slot must not inherit this slot's exclusion.
    restoreSaveSettings('save_15', [machine('other', 11, a.machineType)], defaults, [], () => {}, 15);
    assert.equal(readMachineWatched('other'), true);
});

test('legacy missing watch settings restore the checked default and clear any stale card key', () => {
    const imported = machine('legacy', 11, 'Inv. > Furnace 1');
    localStorage.setItem('optimizer_save_settings_save_1', JSON.stringify({
        order: ['uid:11'], machines: { 'uid:11': { state: defaults(imported) } },
    }));
    localStorage.setItem(machineWatchKey(imported.id), 'false');
    restore([imported]);
    assert.equal(localStorage.getItem(machineWatchKey(imported.id)), null);
    assert.equal(readMachineWatched(imported.id), true);
});

test('only the exact false preference disables watching and unavailable storage defaults to checked', () => {
    assert.equal(readMachineWatched('m'), true);
    for (const value of ['true', '', '0', 'FALSE']) {
        localStorage.setItem(machineWatchKey('m'), value);
        assert.equal(readMachineWatched('m'), true);
    }
    localStorage.setItem(machineWatchKey('m'), 'false');
    assert.equal(readMachineWatched('m'), false);
    const original = globalThis.localStorage;
    try {
        globalThis.localStorage = { getItem() { throw new Error('storage blocked'); } };
        assert.equal(readMachineWatched('m'), true);
    } finally { globalThis.localStorage = original; }
});


test('per-card effect exclusions stay independent through UID moves, reorder and same-slot backups', () => {
    const a = machine('a', 11, 'Inv. > Furnace 1');
    const b = machine('b', 22, 'Inv. > Furnace 2');
    restore([a, b], 'save_14');
    loadCurrent([b, a], 'save_14');
    localStorage.setItem('optimizer_save_slot', '14');
    localStorage.setItem(machineRestrictionsKey(a.id), JSON.stringify(['Degrading']));
    localStorage.setItem(machineRestrictionsKey(b.id), JSON.stringify(['Overcharged']));
    flushSaveSettings();
    const incoming = [machine('a2', 11, 'Inv. > Bay 2 > Furnace 2'), machine('new', 33, a.machineType), machine('b2', 22, 'Inv. > Bay 2 > Furnace 1')];
    const sorted = restoreSaveSettings('save_14_day42_20261120-120000', incoming, defaults, [], () => {}, 14);
    assert.deepEqual(sorted.map(m => m.uid), [22, 11, 33]);
    assert.deepEqual(readForbiddenEffects('a2'), ['Degrading']);
    assert.deepEqual(readForbiddenEffects('b2'), ['Overcharged']);
    assert.deepEqual(readForbiddenEffects('new'), []);
    // Changing one list and clearing the other must not leak between cards.
    loadCurrent(sorted, 'save_14_day42_20261120-120000');
    localStorage.setItem(machineRestrictionsKey('a2'), JSON.stringify(['Degrading', 'Overcharged']));
    localStorage.removeItem(machineRestrictionsKey('b2'));
    flushSaveSettings();
    const next = [machine('a3', 11, a.machineType), machine('b3', 22, b.machineType)];
    restoreSaveSettings('save_14 (1)', next, defaults, [], () => {}, 14);
    assert.deepEqual(readForbiddenEffects('a3'), ['Degrading', 'Overcharged']);
    assert.deepEqual(readForbiddenEffects('b3'), []);
    restoreSaveSettings('renamed slot 15', [machine('other', 11, a.machineType)], defaults, [], () => {}, 15);
    assert.deepEqual(readForbiddenEffects('other'), []);
});

test('legacy missing effect exclusions and entirely new machines reset to the empty default', () => {
    const legacy = machine('legacy', 11, 'Inv. > Furnace 1');
    localStorage.setItem('optimizer_save_settings_save_1', JSON.stringify({
        order: ['uid:11'], machines: { 'uid:11': { state: defaults(legacy) } },
    }));
    localStorage.setItem(machineRestrictionsKey(legacy.id), JSON.stringify(['Degrading', 'Overcharged']));
    const fresh = machine('fresh', 22, 'Inv. > Furnace 2');
    localStorage.setItem(machineRestrictionsKey(fresh.id), JSON.stringify(['Overcharged']));
    restore([legacy, fresh]);
    for (const id of ['legacy', 'fresh']) {
        assert.equal(localStorage.getItem(machineRestrictionsKey(id)), null);
        assert.deepEqual(readForbiddenEffects(id), []);
    }
});
