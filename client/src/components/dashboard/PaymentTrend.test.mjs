import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { chartTicks } from '../charts/geometry.ts';
import { niceTicks, tightLineTicks } from '../../lib/chart-series.ts';

// Exercise the component's actual tick calculation, including its chosen helper.
const source = readFileSync(new URL('./PaymentTrend.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('PaymentTrend.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const body = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'PaymentTrend').body;
const declarations = body.statements.filter(
  (node) =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((d) => ['chartValues', 'ticks'].includes(d.name.getText(ast))),
);
const code = ts.transpileModule(declarations.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const ticksFor = new Function('points', 'chartTicks', 'niceTicks', 'tightLineTicks', `${code}\nreturn ticks;`);

test('payment trends retain a positive dynamic origin across small and wide revenue ranges', () => {
  for (const values of [
    [11000, 29000],
    [11000, 31000],
    [11000, 40000],
    [28000, 28500],
  ]) {
    const ticks = ticksFor(
      values.map((value) => ({ values: { subscription: value } })),
      chartTicks,
      niceTicks,
      tightLineTicks,
    );
    assert.ok(ticks[0] > 0, `range ${values} should not be padded back to zero`);
    assert.ok(ticks[0] <= Math.min(...values));
    assert.ok(ticks.at(-1) >= Math.max(...values));
  }
});
