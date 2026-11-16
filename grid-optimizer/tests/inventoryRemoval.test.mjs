import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryRemovalReason, removeInventoryItem } from '../src/inventoryRemoval.ts';

const item = (id, props = {}) => ({
    id, shape: 'Square4_Base', color: 'Red', displayName: 'Performance Module',
    effects: ['None', 'None'], effectValues: [0, 0], ...props,
});
const context = (inventory, props = {}) => ({
    itemId: inventory[0]?.id ?? 'missing', inventory, usedIds: new Set(),
    isSolving: false, isDragging: false, boardsReady: true, ...props,
});

test('unused imported modules and locked specials can be deleted from local storage', () => {
    assert.equal(inventoryRemovalReason(context([item('imported', { uid: 123, originalPath: 'Inv.' })])), null);
    assert.equal(inventoryRemovalReason(context([item('special', { uid: 456, isLocked: true, color: 'Grey' })])), null);
});

test('final eligibility uses live board ids, even if a previously unused item was just placed', () => {
    const candidate = context([item('module')]);
    assert.equal(inventoryRemovalReason(candidate), null);
    candidate.usedIds.add('module');
    assert.equal(inventoryRemovalReason(candidate), 'placed');
    assert.equal(inventoryRemovalReason(context([item('module', { isLocked: true })], { usedIds: new Set(['module']) })), 'placed');
});

test('cannot remove an infinite source while any derived clone is on a board', () => {
    const node = item('node', { shape: 'Node1x2', color: 'White', isInfinite: true });
    assert.equal(inventoryRemovalReason(context([node])), null);
    assert.equal(inventoryRemovalReason(context([node], { usedIds: new Set(['node_clone_4']) })), 'placed');
    assert.equal(inventoryRemovalReason(context([node], { itemId: 'node_clone_4' })), 'clone');
    // Sharing a prefix does not mean that another real item belongs to this source.
    assert.equal(inventoryRemovalReason(context([node], { usedIds: new Set(['node_other']) })), null);
});

test('blocks mutation during solves, drags, incomplete board initialization, or after the item disappeared', () => {
    const candidate = context([item('module')]);
    assert.equal(inventoryRemovalReason({ ...candidate, isSolving: true }), 'busy');
    assert.equal(inventoryRemovalReason({ ...candidate, isDragging: true }), 'busy');
    assert.equal(inventoryRemovalReason({ ...candidate, boardsReady: false }), 'unready');
    assert.equal(inventoryRemovalReason({ ...candidate, inventory: [] }), 'missing');
    assert.equal(inventoryRemovalReason(context([item('stuck', { isStuck: true })])), 'stuck');
});

test('removal invalidates both before and after Store snapshots, retaining unrelated module identities', () => {
    const removed = item('deleted', { uid: 42 });
    const retained = item('retained', { uid: 43 });
    const clone = item('deleted_clone_0');
    const retainedLayout = { before: [['retained', 'Locked']], after: [[null, 'retained']] };
    const layouts = {
        oldBoard: { before: [['deleted']], after: [['retained']] },
        newBoard: { before: [['retained']], after: [['deleted_clone_2']] },
        untouched: retainedLayout,
    };
    const result = removeInventoryItem('deleted', [removed, retained, clone], ['deleted', 'retained', 'deleted_clone_0'], layouts);
    assert.deepEqual(result.inventory, [retained]);
    assert.equal(result.inventory[0], retained);
    assert.deepEqual(result.storedIds, ['retained']);
    assert.deepEqual(Object.keys(result.storedLayouts), ['untouched']);
    assert.equal(result.storedLayouts.untouched, retainedLayout);
    assert.equal(layouts.oldBoard.before[0][0], 'deleted');
    assert.equal(layouts.newBoard.after[0][0], 'deleted_clone_2');
});

test('a stale duplicate removal is a no-op and reimport may restore the same game uid', () => {
    const inventory = [item('remaining')], storedIds = [], storedLayouts = {};
    const result = removeInventoryItem('gone', inventory, storedIds, storedLayouts);
    assert.equal(result.inventory, inventory);
    assert.equal(result.storedIds, storedIds);
    assert.equal(result.storedLayouts, storedLayouts);
    const original = item('old-id', { uid: 42 });
    assert.deepEqual(removeInventoryItem(original.id, [original], [], {}).inventory, []);
    assert.equal(inventoryRemovalReason(context([item('new-id', { uid: 42 })])), null);
});
