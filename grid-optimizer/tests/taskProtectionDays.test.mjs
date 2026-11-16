import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
};
const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { taskProtectionDays, machineJobKey, desequencerChipsetKey } = await server.ssrLoadModule('/src/machineDefaults.ts');
const { setLang } = await server.ssrLoadModule('/src/i18n.ts');
const id = 'test-machine';
const pickJob = key => localStorage.setItem(machineJobKey(id), key);
test.beforeEach(() => { storage.clear(); setLang('en'); });
test.after(async () => { setLang('en'); await server.close(); });

test('manual speeds below the baseline protect the whole job rather than its baseline days', () => {
    // Default Fillerweed needs eight work, with eight work/day at P=0.
    assert.equal(taskProtectionDays('Hydroponic System', id, 0), 1);
    assert.equal(taskProtectionDays('Hydroponic System', id, -100), 2);
    assert.equal(taskProtectionDays('Hydroponic System', id, -150), 4);
    assert.equal(taskProtectionDays('Hydroponic System', id, -200), 365);
    // A printer's default Gun Parts need 30 work; half its base speed is 12/day.
    assert.equal(taskProtectionDays('3D Printer', id, -50), 3);
});

test('the selected Desequencer chipset provides the two, three and four day horizons', () => {
    localStorage.setItem(desequencerChipsetKey(id), '125');
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 0), 4);
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 28), 3);
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 91), 2);
    localStorage.setItem(desequencerChipsetKey(id), '150');
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 16), 4);
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 52), 3);
    assert.equal(taskProtectionDays('Cryptographic Desequencer', id, 128), 2);
});

test('changing the picked job changes the horizon using its actual work requirement', () => {
    pickJob('nutrifruit');
    assert.equal(taskProtectionDays('Hydroponic System', id, 0), 2);
    pickJob('kotton');
    assert.equal(taskProtectionDays('Hydroponic System', id, 0), 6);
    assert.equal(taskProtectionDays('Hydroponic System', id, 100), 4);
    pickJob('hydroreed');
    assert.equal(taskProtectionDays('Hydroponic System', id, 0), 3);
    assert.equal(taskProtectionDays('Hydroponic System', id, 100), 2);
});

test('a seed or chip read from the save keeps its own work amount and manual speed duration', () => {
    pickJob('seed:coffee:65:9');
    assert.equal(taskProtectionDays('Hydroponic System', id, 0), 9);
    assert.equal(taskProtectionDays('Hydroponic System', id, 100), 6);
    assert.equal(taskProtectionDays('Hydroponic System', id, -100), 17);
    pickJob('chip:125:1:Custom chip: 999 days');
    assert.equal(taskProtectionDays('3D Printer', id, 0), 6);
    assert.equal(taskProtectionDays('3D Printer', id, 100), 3);
    assert.equal(taskProtectionDays('3D Printer', id, -50), 11);
});

test('DNA operations use the picked complexity and other machines default to one day', () => {
    pickJob('4'); // 20 + 4*4 = 36 work, base speed 10/day.
    assert.equal(taskProtectionDays('DNA Manipulator', id, 0), 4);
    assert.equal(taskProtectionDays('DNA Manipulator', id, 100), 3);
    assert.equal(taskProtectionDays('DNA Manipulator', id, 200), 2);
    assert.equal(taskProtectionDays('DNA Manipulator', id, -100), 8);
    pickJob('any');
    assert.equal(taskProtectionDays('DNA Manipulator', id, 100), 1);
    assert.equal(taskProtectionDays('Furnace', id, 100), 1);
});

test('horizon calculation is independent of translated labels and numbers in custom names', () => {
    const readings = [];
    for (const lang of ['en', 'zh']) {
        setLang(lang);
        pickJob('seed:coffee:65:9');
        const seed = taskProtectionDays('Hydroponic System', id, 100);
        pickJob('chip:125:1:两天 999d: custom 3天');
        const chip = taskProtectionDays('3D Printer', id, 100);
        localStorage.setItem(desequencerChipsetKey(id), '125');
        readings.push([seed, chip, taskProtectionDays('Cryptographic Desequencer', id, 91)]);
    }
    assert.deepEqual(readings, [[6, 3, 2], [6, 3, 2]]);
});
