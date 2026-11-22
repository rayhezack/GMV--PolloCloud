import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import { decomposeCount, decomposeRate, summarizeChanges } from '@/components/dashboard/chain-diagnostics';
import { netChangeShare } from '@shared/rate-attribution';
import { count, rate } from '@shared/format';

type CountResult = ReturnType<typeof decomposeCount>;
type RateResult = ReturnType<typeof decomposeRate>;
const pp = (n: number) => `${Math.abs(n * 100).toFixed(2)} pp`;
const people = (n: number) => `${n < 0 ? '减少' : '增加'} ${count(Math.abs(n))} 人`;

/** A short evidence reading: business claim, key support, then the unresolved question. */
export function CountConclusion({
  result,
  label,
  dimension,
}: {
  result: CountResult;
  label: string;
  dimension: 'country' | 'exposure';
}) {
  if (!result.valid)
    return (
      <aside className="chain-reading">
        <strong>当前分类不足以解释整体变化</strong>
        <p>明细与合计未守恒，当前仅保留人数；需要核对分类是否交叉或遗漏。</p>
      </aside>
    );
  const impacts = summarizeChanges(result.groups);
  const hasNetChange = Math.abs(result.delta) > 1e-10;
  const drivers = (result.delta < 0 ? impacts.drags : impacts.lifts).slice(0, 2);
  const opposite = (result.delta < 0 ? impacts.lifts : impacts.drags)[0];
  const lead = drivers[0];
  const groupName = dimension === 'country' ? '国家层级' : '触发场景';
  const headline = !hasNetChange
    ? `${label}总体持平${impacts.lifts.length && impacts.drags.length ? '，分组间变化相互抵消' : ''}`
    : opposite
      ? `${label}${result.delta < 0 ? '下降' : '增长'}集中在${lead?.label || '部分' + groupName}，其他${groupName}形成对冲`
      : `${lead?.label || '当前分组'}是${label}${result.delta < 0 ? '减少' : '增加'}的主要来源`;
  return (
    <aside className="chain-reading" aria-label={`${label}诊断结论`}>
      <strong>
        <WorkbenchIcon name="file-chart" active />
        {headline}
      </strong>
      <ol>
        <li>
          <WorkbenchIcon name="chart-line" />
          <div>
            <b>{lead ? `${lead.label}主导变化：` : '整体未发生净变化：'}</b>
            {drivers.map((g) => `${g.label}日均${people(g.change)}`).join('，')}
            {drivers.length > 0 && hasNetChange
              ? dimension === 'country'
                ? `，合计解释当前${result.delta < 0 ? '减少' : '增加'}人数的 ${Math.abs((drivers.reduce((n, g) => n + g.change, 0) / result.delta) * 100).toFixed(1)}%。`
                : `；整体日均仅${people(result.delta)}。`
              : '各组增减相互抵消，净变化为零时不计算贡献占比。'}
            {opposite &&
              `${opposite.label}日均${people(opposite.change)}，抵消了部分变化，因此净变动小于主要分组的变动。`}
          </div>
        </li>
        {dimension === 'exposure' ? (
          <li>
            <WorkbenchIcon name="link" />
            <div>
              <b>触发人数变化尚未解释到具体入口：</b>
              当前分类能定位曝光变化的场景，但没有各场景对应的活跃人数，不能据此判断曝光率升降。
              {lead &&
                `应先核对${lead.label}对应入口的触发人数、覆盖范围和生效记录，确认是覆盖人数变化还是触发条件变化。`}
            </div>
          </li>
        ) : (
          <li>
            <WorkbenchIcon name="搜索" />
            <div>
              <b>国家层级定位了流量变化，来源仍需核查：</b>
              {lead
                ? `先检查${lead.label}内的国家及获客来源，比较同期新增与存量活跃变化。`
                : '先检查各层级内部国家的增减。'}
              国家层级人数本身不能证明投放调整、流量故障或产品动作造成了变化。
            </div>
          </li>
        )}
      </ol>
    </aside>
  );
}
export function RateConclusion({
  result,
  metric = '提交支付率',
  dimension = '渠道',
}: {
  result: RateResult;
  metric?: string;
  dimension?: string;
}) {
  const submission = metric === '付费墙提交率';
  const efficiencyName = submission ? '提交效率' : '支付效率';
  const structureName = submission ? '曝光结构' : '提交结构';
  const withinRate = submission ? '付费墙提交率' : '提交支付率';
  const population = submission ? '曝光人群' : '提交人群';
  if (!result.valid || result.delta == null)
    return (
      <aside className="chain-reading">
        <strong>当前明细不足以解释{metric}变化</strong>
        <p>{result.reason}</p>
      </aside>
    );
  const { delta, efficiency, structure, unresolved } = result;
  const dominant =
    Math.abs(unresolved) > Math.max(Math.abs(efficiency), Math.abs(structure))
      ? 'unresolved'
      : Math.abs(efficiency) >= Math.abs(structure)
        ? 'efficiency'
        : 'structure';
  const leading = [...result.groups]
    .filter(
      (g) =>
        !g.absent && g[dominant === 'unresolved' ? 'unresolvedEffect' : dominant] * Math.sign(result[dominant]) > 1e-10,
    )
    .sort(
      (a, b) =>
        Math.abs(b[dominant === 'unresolved' ? 'unresolvedEffect' : dominant]) -
        Math.abs(a[dominant === 'unresolved' ? 'unresolvedEffect' : dominant]),
    )[0];
  const headline =
    dominant === 'unresolved'
      ? `不可比分组限制了对${metric}变化的解释`
      : dominant === 'efficiency'
        ? `${metric}${delta < 0 ? '下降' : '提升'}主要来自${efficiencyName}变化`
        : `${metric}${delta < 0 ? '下降' : '提升'}主要来自${structureName}变化`;
  return (
    <aside className="chain-reading" aria-label={`${metric}诊断结论`}>
      <strong>
        <WorkbenchIcon name="file-chart" active />
        {Math.abs(delta) < 1e-10 ? `整体${metric}持平，内部结构与效率仍有变化` : headline}
      </strong>
      <ol>
        <li>
          <WorkbenchIcon name="chart-line" />
          <div>
            <b>
              {dominant === 'efficiency'
                ? `${efficiencyName}变化占主导：`
                : dominant === 'structure'
                  ? `${structureName}变化占主导：`
                  : '未归因部分需要先补齐：'}
            </b>
            整体{metric}由 {rate(result.baselineRate)} 变为 {rate(result.currentRate)}。{dimension}内{withinRate}变化
            {efficiency < 0 ? '拉低' : '拉高'}整体 {pp(efficiency)}，{population}分布变化
            {structure < 0 ? '拉低' : '拉高'} {pp(structure)}。
            {Math.abs(unresolved) > 1e-10 &&
              `不可比分组另有 ${pp(unresolved)} 的${unresolved < 0 ? '向下' : '向上'}影响，未分摊给效率或结构。`}
          </div>
        </li>
        {leading && (
          <li>
            <WorkbenchIcon name="搜索" />
            <div>
              <b className="chain-reading-check">{leading.label}是主要核查对象：</b>
              {dominant === 'efficiency'
                ? `该${dimension}${withinRate}从 ${rate(leading.rate0)} 变为 ${rate(leading.rate1)}，对整体贡献 ${pp(leading.efficiency)} 的${leading.efficiency < 0 ? '下降' : '上升'}。`
                : `该${dimension}${population}占比从 ${rate(leading.w0)} 变为 ${rate(leading.w1)}，其${withinRate}同期为 ${rate(leading.rate1)}。`}
              {submission
                ? '应核对该层级内的付费墙入口、套餐及曝光人群构成。'
                : `应核对该${dimension}覆盖订单的支付配置与失败记录。`}
              当前数据未建立具体产品动作与该变化的对应关系。
            </div>
          </li>
        )}
        {result.simpson && (
          <li>
            <WorkbenchIcon name="link" />
            <div>
              <b>整体与分组内部方向相反：</b>可比分组自身变化均与整体反向，{population}在{dimension}
              间的转移改变了整体结果。
            </div>
          </li>
        )}
      </ol>
      <div className="chain-reading-effects" aria-label="总体变化贡献">
        {[
          { label: `${efficiencyName}变化`, value: efficiency },
          { label: `${structureName}变化`, value: structure },
          ...(Math.abs(unresolved) > 1e-10 ? [{ label: '未归因', value: unresolved }] : []),
        ].map(({ label, value }) => {
          const contribution = netChangeShare(value, delta);
          return (
            <div key={label}>
              <span>{label}</span>
              <b>
                {value < 0 ? '−' : '+'}
                {pp(value)}
              </b>
              <span>占净变化 {contribution == null ? '—' : `${(contribution * 100).toFixed(1)}%`}</span>
            </div>
          );
        })}
      </div>
      <p className="chain-reading-note">
        {Math.abs(delta) < 1e-10
          ? '整体净变化为零，不计算贡献占比。'
          : '占比以整体提交支付率净变化为分母，负值表示抵消，正负贡献合计为 100%。'.replace('提交支付率', metric)}
      </p>
    </aside>
  );
}
