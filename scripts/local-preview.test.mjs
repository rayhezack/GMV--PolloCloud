import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { remoteD1DevProxy } from './remote-d1-dev-proxy.mjs';
test('missing snapshot fails closed without loading the Worker or a remote adapter', async()=>{
  const cwd=process.cwd();const dir=mkdtempSync(path.join(tmpdir(),'pollo-local-preview-'));process.chdir(dir);
  let middleware;let loaded=false;
  try {
    remoteD1DevProxy().configureServer({watcher:{on(){}},middlewares:{use(fn){middleware=fn;}},ssrLoadModule(){loaded=true;throw Error('must not load');}});
    const response={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
    await middleware({url:'/api/dashboard/overview',method:'GET'},response,()=>{throw Error('must not pass through');});
    assert.equal(response.statusCode,503);assert.match(response.body,/远程查询已禁用/);assert.equal(loaded,false);
  } finally {process.chdir(cwd);}
});
