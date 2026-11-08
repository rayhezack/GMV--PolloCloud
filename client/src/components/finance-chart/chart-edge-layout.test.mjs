import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { flowBarLayout, flowBarTop, endpointLabels, bucketLabels } from './flow-bar-layout.ts';
import { niceTicks } from './series.ts';

// Exercise the actual private layout functions in both entry points without
// mounting charts or replacing their production exports just for testing.
function loadLayout(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['PLOT_HEIGHT', 'GRID_TOP', 'BASE', 'SPAN', 'TICK_COUNT',
    'BAR_WIDTH', 'BAR_BOTTOM', 'MARKER', 'HOUR', 'DAY', 'timeOf', 'sorted']);
  const functions = new Set(['monthPosition', 'timeScale', 'layoutChart']);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    ? functions.has(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(ast))));
  const code = ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function('flowBarLayout', 'flowBarTop', 'endpointLabels', 'bucketLabels', 'niceTicks', `${code}\nreturn layoutChart;`)(flowBarLayout, flowBarTop, endpointLabels, bucketLabels, niceTicks);
}

for (const entry of ['../global-finance-market-combo-chart.tsx', './GlobalFinanceMarketComboChart.tsx']) {
  const layout = loadLayout(entry);
  test(`${entry}: tiny nonzero differences remain visible without changing their amounts`, () => {
    const values = [-82, 82, -0.01, 0.01, 0, -10000, 10000];
    const actual = values.map((_, i) => ({ date: `2026-10-${String(20+i).padStart(2,'0')}`, value: 70000 }));
    const flows = actual.map((p, i) => ({ ...p, value: values[i] }));
    const result = layout({ actual, flows }, { actual:true, forecast:true }, 720);
    assert.equal(result.bars.length, actual.length);
    for (const [i, bar] of result.bars.entries()) {
      assert.equal(bar.value, values[i], 'tooltip/export retain the real signed amount');
      assert.equal(bar.negative, values[i] < 0);
      const height = bar.bottom-bar.top;
      if (values[i] === 0) assert.equal(height, 0, 'zero must not become an invented change');
      else assert.ok(height >= 3, `${values[i]} must have a visible bar, got ${height}px`);
      if (Math.abs(values[i]) === 10000) {
        assert.ok(Math.abs(height-Math.abs(result.y(10000)-result.y(0))) < 1e-9, 'larger deltas retain their scale');
      }
    }
  });
  test(`${entry}: observed endpoints and signed bars fit narrow/wide plots with comparison gaps`, () => {
    for (const count of [1, 7, 30, 90]) for (const width of [160, 280, 720, 1200]) {
      const actual = Array.from({length:count}, (_, i) => ({date:new Date(Date.UTC(2026,9,6+i)).toISOString().slice(0,10),value:100+i}));
      const forecast = actual.slice(7).filter((_, i) => i !== 4);
      const flows = forecast.map((p,i) => ({...p,value:i%2 ? -20 : 20}));
      for (const data of [{actual,forecast,flows}, {actual}]) {
        const result = layout(data, {actual:true,forecast:true}, width);
        assert.equal(result.labels[0].time, Date.parse(actual[0].date));
        assert.equal(result.labels.at(-1).time, Date.parse(actual.at(-1).date));
        assert.equal(result.bars.length, data.flows?.length ?? 0);
        for(const bar of result.bars) {
          assert.ok(bar.x >= 0);
          assert.ok(bar.x+bar.width <= width+1e-9);
          const point=result.actual.find(p=>p.time===bar.time);
          assert.ok(Math.abs(bar.x+bar.width/2-point.x)<1e-9, 'bar remains centered on its real date');
        }
        assert.ok(result.actual[0].x >= 8);
        assert.ok(result.actual.at(-1).x <= width-8);
      }
    }
  });
}
