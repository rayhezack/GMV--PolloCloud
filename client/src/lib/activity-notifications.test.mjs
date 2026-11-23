import test from 'node:test';
import assert from 'node:assert/strict';
import { publishActivity, readActivities, readActivity, unreadActivitySnapshot, activitySnapshot } from './activity-notifications.ts';
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

test('read messages disappear from the visible list without resurfacing on repeated polling',()=>{
 readActivities();
 assert.deepEqual(unreadActivitySnapshot(),[]);
 publishActivity({id:'sync:inbox-a',title:'A'});
 publishActivity({id:'sync:inbox-b',title:'B'});
 assert.deepEqual(unreadActivitySnapshot().map(x=>x.id),['sync:inbox-b','sync:inbox-a']);
 readActivity('sync:inbox-a');
 assert.deepEqual(unreadActivitySnapshot().map(x=>x.id),['sync:inbox-b']);
 const stable=unreadActivitySnapshot();
 publishActivity({id:'sync:inbox-a',title:'Repeated completed job'});
 assert.equal(unreadActivitySnapshot(),stable);
 assert.ok(activitySnapshot().find(x=>x.id==='sync:inbox-a').read);
 readActivities();
 assert.deepEqual(unreadActivitySnapshot(),[]);
});

test('a reload restores unread-only messages and remembers read event identities',async()=>{
 const oldStorage=globalThis.localStorage;
 const saved=new Map([['pollo-activity-v1',JSON.stringify([{id:'sync:old',title:'Read event',read:true},{id:'sync:new',title:'Unread event'}])]]);
 globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)};
 try {
  const inbox=await import(new URL('./activity-notifications.ts?reload-inbox',import.meta.url).href);
  assert.deepEqual(inbox.unreadActivitySnapshot().map(x=>x.id),['sync:new']);
  inbox.publishActivity({id:'sync:old',title:'Repeated read event'});
  assert.equal(inbox.unreadActivitySnapshot().length,1);
  inbox.readActivities();
  const reloaded=await import(new URL('./activity-notifications.ts?reload-after-read',import.meta.url).href);
  assert.deepEqual(reloaded.unreadActivitySnapshot(),[]);
  reloaded.publishActivity({id:'sync:new',title:'Repeated after reload'});
  assert.deepEqual(reloaded.unreadActivitySnapshot(),[]);
 }finally{
  if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;
 }
});
