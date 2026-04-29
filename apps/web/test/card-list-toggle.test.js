import test from 'node:test';
import assert from 'node:assert/strict';
import { getToggleActiveAction } from '../src/components/card-active-toggle.js';

test('toggle action for active card shows Deactivate and sets nextActive=false', () => {
  const action = getToggleActiveAction(true);
  assert.equal(action.label, 'Deactivate');
  assert.equal(action.nextActive, false);
});

test('toggle action for inactive card shows Activate and sets nextActive=true', () => {
  const action = getToggleActiveAction(false);
  assert.equal(action.label, 'Activate');
  assert.equal(action.nextActive, true);
});
