import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const { deriveTaskSafety, evaluateTaskDrop, taskDailyWork, statProtectionUsesForDays } = await server.ssrLoadModule('/src/taskSafety.ts');
test.after(async () => { await server.close(); });
const job = (kind = 'printer', extra = {}) => ({ active: true, kind, current: 0, required: 48, importedDay: 20, ...extra });

test('running progress protects remaining work rather than starting a fresh job on each import', () => {
    const initial = deriveTaskSafety(job(), 0);
    assert.equal(initial.remainingDays, 2);
    assert.equal(initial.protectionUses, 1);
    assert.deepEqual(initial.statProtectionUses, { Performance: 1, Quality: 1, Efficiency: 1 });
    assert.equal(initial.completionDay, 22);
    const next = deriveTaskSafety(job('printer', { current: 24, importedDay: 21 }), 0);
    assert.equal(next.remainingWork, 24);
    assert.equal(next.remainingDays, 1);
    assert.equal(next.protectionUses, 0);
    assert.equal(next.completionDay, 22);
});

test('the two-day example is safe on its finishing drop and warns in advance after reimport', () => {
    const initial = deriveTaskSafety(job(), 0);
    const risk = evaluateTaskDrop(2, initial, 'Quality');
    assert.equal(risk.severity, 'safe');
    assert.equal(risk.safeAfterCompletion, true);
    assert.equal(risk.firstDropDay, 22);
    const next = deriveTaskSafety(job('printer', { current: 24, importedDay: 21 }), 0);
    const advance = evaluateTaskDrop(1, next, 'Quality');
    assert.equal(advance.severity, 'warning');
    assert.equal(advance.timing, 'next-day');
    assert.equal(advance.firstDropDay, 22);
    assert.equal(advance.safeAfterCompletion, true);
    assert.equal(evaluateTaskDrop(1, initial, 'Quality').severity, 'unsafe');
});

test('pre-use machines keep a drop at the final use out of red task failure status', () => {
    for (const [kind, required] of [['hydroponic', 16], ['dna', 20], ['printer', 48]]) {
        const task = deriveTaskSafety(job(kind, { required }), 0);
        assert.equal(task.remainingDays, 2);
        assert.equal(task.phase, 'pre-use');
        for (const stat of ['Performance', 'Quality', 'Efficiency']) {
            assert.equal(evaluateTaskDrop(1, task, stat).severity, 'unsafe');
            assert.equal(evaluateTaskDrop(2, task, stat).severity, 'safe');
        }
    }
});

test('Desequencer Performance reads post-use while its other stats remain pre-use', () => {
    const task = deriveTaskSafety(job('desequencer', { required: 66 }), 0);
    assert.equal(task.remainingDays, 2);
    assert.equal(task.phase, 'post-use-performance');
    assert.deepEqual(task.statProtectionUses, { Performance: 2, Quality: 1, Efficiency: 1 });
    assert.equal(evaluateTaskDrop(2, task, 'Performance').severity, 'unsafe');
    assert.equal(evaluateTaskDrop(2, task, 'Efficiency').severity, 'safe');
    const finalDay = deriveTaskSafety(job('desequencer', { current: 33, required: 66, importedDay: 21 }), 0);
    assert.equal(evaluateTaskDrop(1, finalDay, 'Performance').severity, 'unsafe');
    assert.equal(evaluateTaskDrop(1, finalDay, 'Efficiency').severity, 'warning');
});

test('daily work matches the existing rounded machine speed rules', () => {
    assert.equal(taskDailyWork('printer', 100), 48);
    assert.equal(taskDailyWork('hydroponic', 100), 12);
    assert.equal(taskDailyWork('dna', 100), 15);
    assert.equal(taskDailyWork('desequencer', 100), 66);
    assert.equal(taskDailyWork('hydroponic', -1), 7);
    assert.equal(taskDailyWork('dna', -1), 9);
    assert.equal(taskDailyWork('printer', -1), 24);
});

test('blocked, invalid, inactive and completed jobs cannot create a false finite completion promise', () => {
    assert.equal(deriveTaskSafety(null, 0), null);
    assert.equal(deriveTaskSafety(job('printer', { active: false }), 0), null);
    assert.equal(deriveTaskSafety(job('printer', { current: 48 }), 0), null);
    assert.equal(deriveTaskSafety(job('printer', { current: -1 }), 0), null);
    assert.equal(deriveTaskSafety(job('printer', { required: NaN }), 0), null);
    const stopped = deriveTaskSafety(job(), -100);
    assert.equal(stopped.remainingDays, null);
    assert.equal(stopped.phase, 'blocked');
    assert.equal(stopped.completionDay, null);
    assert.equal(stopped.protectionUses, 365);
    assert.equal(evaluateTaskDrop(400, stopped, 'Quality').severity, 'unsafe');
});

test('calendar day stays unknown when the save did not contain a usable day', () => {
    const task = deriveTaskSafety(job('printer', { importedDay: null }), 0);
    assert.equal(task.completionDay, null);
    assert.equal(evaluateTaskDrop(2, task, 'Quality').firstDropDay, null);
    assert.deepEqual(evaluateTaskDrop(null, task, 'Quality'), {
        severity: 'safe', timing: 'none', firstDropDay: null, safeAfterCompletion: false,
    });
});

test('planned job windows preserve the same per-stat finishing boundary without running progress', () => {
    assert.deepEqual(statProtectionUsesForDays('3D Printer', 2), { Performance: 1, Quality: 1, Efficiency: 1 });
    assert.deepEqual(statProtectionUsesForDays('Cryptographic Desequencer', 2), { Performance: 2, Quality: 1, Efficiency: 1 });
    assert.deepEqual(statProtectionUsesForDays('hydroponic', 1), { Performance: 0, Quality: 0, Efficiency: 0 });
    assert.equal(statProtectionUsesForDays('Moisture Farm', 2), null);
});

test('declining Auto performance is simulated rather than freezing the initial work rate', () => {
    const task = deriveTaskSafety(job('printer', { required: 72 }), uses => uses === 0 ? 100 : 0);
    assert.equal(task.dailyWork, 48);
    assert.equal(task.remainingDays, 2);
    const longer = deriveTaskSafety(job('printer', { required: 96 }), uses => uses === 0 ? 100 : 0);
    assert.equal(longer.remainingDays, 3, '48 + 24 + 24, rather than two nights at the initial48');
    const postUse = deriveTaskSafety(job('desequencer', { required: 66 }), uses => uses === 0 ? 100 : 0);
    assert.equal(postUse.dailyWork, 33);
    assert.equal(postUse.remainingDays, 2, 'Desequencer uses the post-degradation snapshot on its first night');
});
