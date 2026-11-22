import test from 'node:test';
import assert from 'node:assert/strict';
import { publishActivity, readActivities, activitySnapshot } from './activity-notifications.ts';
test('completion events deduplicate polling, preserve read state and count newly arriving events', () => {
  for (const id of ['anomaly:test', 'report:test', 'sync:test']) publishActivity({ id, title: id });
  assert.equal(activitySnapshot().filter(item => !item.read).length, 3);
  publishActivity({ id: 'sync:test', title: 'Repeated poll' });
  assert.equal(activitySnapshot().length, 3);
  readActivities();
  publishActivity({ id: 'sync:test', title: 'Already read' });
  assert.equal(activitySnapshot().filter(item => !item.read).length, 0);
  publishActivity({ id: 'report:next', title: 'Next report' });
  assert.equal(activitySnapshot().filter(item => !item.read).length, 1);
});
