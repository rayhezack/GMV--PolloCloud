import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getGmvCoverage } from '@/api/dashboard';
import type { DashboardGmvCoverageResponse, Platform } from '@shared/api.interface';
import { PageHeader, PanelState, DataTable, InfoTip } from '@/components/system';
import { money, rate } from '@shared/format';
import './data-page.css';
const SyncControlBar = lazy(() => import('../DashboardPage/SyncControlBar'));
export default function DataPage() {
  const { hash } = useLocation();
  const [data, setData] = useState<DashboardGmvCoverageResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (hash === '#method-anomaly') document.getElementById('method-anomaly')?.scrollIntoView({ block: 'start' });
  }, [hash, loading]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void getGmvCoverage()
      .then((value) => {
        if (live) setData(value);
      })
      .catch(() => {
        if (live) setError('覆盖差异读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <div className="v62-page v62-sheet-page data-page">
      <PageHeader title="数据与口径" />
      <Suspense fallback={<PanelState state="loading" />}>
        <SyncControlBar onSyncSettled={() => setRevision((v) => v + 1)} />
      </Suspense>
      <GmvCoverageExplanation data={data} loading={loading} error={error} />
    </div>
  );
}
const CHAIN_METRIC_DEFINITIONS = [
  { label: '付费墙曝光率', formula: '付费墙曝光UV / DAU' },
  { label: '付费墙提交率', formula: '付费墙支付提交UV / 付费墙曝光UV' },
  { label: '提交支付率', formula: '支付UV / 付费墙支付提交UV' },
  { label: '客单价', formula: '主动付费GMV / 支付UV' },
] as const;

const RENEWAL_METRIC_DEFINITIONS = [
  { label: '续订率', formula: '续订用户数 / 到期用户数' },
  { label: '续订客单价', formula: '续订金额 / 续订用户数' },
] as const;

function GmvCoverageExplanation({
  data,
  loading,
  error,
}: {
  data: DashboardGmvCoverageResponse | null;
  loading: boolean;
  error?: string;
}) {
  const platformRows = data ? (['web', 'app'] as Platform[]).map((platform) => data.platforms[platform]) : [];

  return (
    <article className="dashboard-methodology">
      <aside className="dashboard-methodology-rail">
        <span>数据口径</span>
        <nav aria-label="数据口径目录">
          <a href="#method-coverage">覆盖差异</a>
          <a href="#method-lineage">图表血缘</a>
          <a href="#method-window">统计窗口</a>
          <a href="#method-active">主动付费</a>
          <a href="#method-drill">下钻口径</a>
          <a href="#method-renewal">自动续订</a>
          <a href="#method-anomaly">异动诊断</a>
          <a href="#method-payment">支付与归因</a>
          <a href="#method-creative">创作分层</a>
        </nav>
      </aside>
      <div className="dashboard-methodology-body">
        <header className="dashboard-methodology-header">
          <h2>口径说明</h2>
        </header>
        <div className="dashboard-methodology-intro">
          <div className="dashboard-methodology-intro-copy">
            <span className="dashboard-methodology-kicker">先看结论</span>
            <h3>同名 GMV 可能不同，先确认数据来源</h3>
            <p>付费类型、支付链路和 GMV 趋势回答的问题不同，因此不能直接把页面上的同名数值相加或互相替换。</p>
          </div>
          <div className="dashboard-methodology-source-grid">
            <div>
              <strong>结果口径</strong>
              <span>付费类型页直接汇总支付结果，回答“实际收到了多少 GMV”。</span>
            </div>
            <div>
              <strong>归因口径</strong>
              <span>支付链路页按行为时间顺序串联，回答“哪些链路解释了变化”。</span>
            </div>
            <div>
              <strong>趋势口径</strong>
              <span>GMV 趋势按独立趋势窗口汇总，自动续订按支付日期观察变化。</span>
            </div>
          </div>
        </div>
        <section id="method-coverage" className="dashboard-methodology-section dashboard-methodology-section-first">
          <h3>先看 GMV 覆盖差异</h3>
          <p>
            这张表用于解释为什么付费类型页、支付链路页和 GMV
            趋势页的数值可能不同。付费类型表是支付结果口径，链路归因表只包含能够按行为顺序串联的部分。
          </p>
          <div className="dashboard-methodology-source-list">
            <div>
              <strong>付费类型表</strong>
              <span>按支付结果汇总，作为结果核对基准。</span>
            </div>
            <div>
              <strong>链路归因表</strong>
              <span>按 DAU、曝光、提交、支付的时间顺序归因，未能串联的结果不会被强行分配。</span>
            </div>
            <div>
              <strong>未归因差额</strong>
              <span>两种口径的日均差异，用于定位覆盖范围，不代表链路贡献度。</span>
            </div>
          </div>
          <div className="dashboard-methodology-coverage">
            {loading ? (
              <p className="dashboard-methodology-status">正在计算最近四个完整业务周的 GMV 覆盖差异…</p>
            ) : error ? (
              <p className="dashboard-methodology-status text-destructive">口径差异暂时无法读取：{error}</p>
            ) : platformRows.length === 0 ? (
              <p className="dashboard-methodology-status">暂无最近四个共同业务周数据。</p>
            ) : (
              <DataTable
                rows={platformRows.map((row) => ({ ...row, id: row.platform }))}
                columns={[
                  { key: 'platform', header: '端', render: (r) => (r.platform === 'web' ? 'Web' : 'App') },
                  { key: 'pay', header: '支付结果 · USD', numeric: true, render: (r) => money(r.payTypeDailyAvg) },
                  { key: 'chain', header: '链路 · USD', numeric: true, render: (r) => money(r.chainDailyAvg) },
                  {
                    key: 'residual',
                    header: '未归因差额 · USD',
                    numeric: true,
                    render: (r) => money(r.unattributedDailyAvg),
                  },
                  {
                    key: 'share',
                    header: (
                      <>
                        未归因占比
                        <InfoTip>
                          最近四个完整业务周的水平差额 ÷ 支付结果 GMV。支付链路页的未归因贡献度计算的是两期差额的变化 ÷
                          GMV 净变化；两者不可互换。
                        </InfoTip>
                      </>
                    ),
                    numeric: true,
                    render: (r) => rate(r.unattributedRate),
                  },
                ]}
              />
            )}
          </div>
        </section>
        <section id="method-lineage" className="dashboard-methodology-section">
          <h3>图表与数据源</h3>
          <p>
            看板读取 D1
            同步表，按页面所选端口、日期与业务周聚合；血缘图展示实际依赖，源表缺失或对账未通过时不推定缺失维度。
          </p>
          <a href="/assets/lineage/data-lineage.html" target="_blank" rel="noreferrer">
            查看完整血缘图
          </a>
          <iframe
            className="dashboard-lineage-viewer"
            src="/assets/lineage/data-lineage.html"
            title="交互式数据血缘：上游表、D1 与看板依赖"
            loading="lazy"
          />
        </section>
        <section id="method-window" className="dashboard-methodology-section">
          <h3>统计窗口</h3>
          <p>付费类型、支付链路和创作分层页面按各分析页的业务周选择器比较；GMV 趋势页面使用独立趋势窗口。</p>
          <p>覆盖差异使用最近四个完整业务周的数据，每周先计算日均，再比较两张结果表的覆盖范围。</p>
        </section>
        <section id="method-active" className="dashboard-methodology-section">
          <h3>主动付费 GMV</h3>
          <p>
            付费类型页的主动付费 GMV
            来自支付结果汇总；支付链路页的过程指标来自链路归因表。链路页的贡献度只在链路口径内计算，不能用来替代支付结果总额。
          </p>
          <p className="dashboard-methodology-formula">
            主动付费 GMV = DAU × 付费墙曝光率 × 付费墙提交率 × 提交支付率 × 客单价
          </p>
          <dl className="dashboard-methodology-definitions">
            {CHAIN_METRIC_DEFINITIONS.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.formula}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section id="method-drill" className="dashboard-methodology-section">
          <h3>主动付费下钻：按功能与注册新老</h3>
          <p>
            下钻只解释主动付费内部的 GMV
            变化，不改变上方付费类型页的结果口径。分析期和基准期分别按各自实际有效天数计算日均 GMV，再比较两期日均变化。
          </p>
          <dl className="dashboard-methodology-definitions">
            <div>
              <dt>功能如何归到用户</dt>
              <dd>
                归因颗粒度是“用户-自然日”，不是单笔订单。先按用户和自然日去重，同一用户当天只保留一个功能归属；再把该用户当天的主动付费
                GMV 汇总到这个功能。功能取支付前最近一次可匹配事件：优先使用 source_function；没有该来源时回退到
                createflow_form_submit 的 form_type。source_function 是近期新增埋点，2026 年 9
                月及更早数据若不存在该事件，完全依赖 form_type；不对缺失事件做日期外推。
              </dd>
            </div>
            <div>
              <dt>未归因功能</dt>
              <dd>
                未归因不是 0 GMV，而是没有可匹配功能事件的用户-日期金额，包括主动点击 Pricing
                页面或主动曝光付费弹窗后直接支付、事件缺失、用户 ID
                无法匹配等情况。此类金额保留在主动付费总额中，并单独汇总为“未归因功能”，不从总 GMV 中剔除。
              </dd>
            </div>
            <div>
              <dt>按功能的贡献度</dt>
              <dd>
                功能日均变化 ÷ 当前主动付费下钻全部功能的日均净变化。完整功能列表（包含“未归因功能”）的贡献度合计约为
                100%；正负功能可以相互抵消，因此单个功能可能超过 100% 或为负数。
              </dd>
            </div>
            <div>
              <dt>注册新老</dt>
              <dd>
                “新用户”指注册日期落在当前分析业务周内的用户；“老用户”指在业务周开始前已经注册的用户；缺少注册日期或无法匹配用户的标记为“未知”。这里描述的是选定付费类型或功能下发生付费的用户-日期，不是全站用户分群，也不等同于创作分层。
              </dd>
            </div>
            <div>
              <dt>注册新老的贡献度</dt>
              <dd>
                用户群日均变化 ÷ 当前选定付费类型或功能的日均净变化。净变化接近 0 时，贡献度可能超过
                100%；没有拆分标签的记录保留为“未知”。
              </dd>
            </div>
            <div>
              <dt>搜索后的合计</dt>
              <dd>搜索只过滤展示行，不改变贡献度分母；因此搜索结果中可见功能的贡献度合计不一定等于 100%。</dd>
            </div>
          </dl>
        </section>
        <section id="method-renewal" className="dashboard-methodology-section">
          <h3>自动续订 GMV</h3>
          <p>
            付费类型页按支付日期汇总付费类型表中当日实际发生的续费
            GMV，回答“这一天收到了多少续费收入”。续订表和支付链路的自动续订归因以到期用户作为
            cohort，回答“这批到期用户中有多少续费，以及带来了多少续费 GMV”。GMV 趋势页同样按支付日期汇总支付表中
            description=cycle 的记录，因此按发生日统计的结果与按到期 cohort 统计的结果不会直接一致。
          </p>
          <p className="dashboard-methodology-formula">续订 GMV = 到期用户数 × 续订率 × 续订客单价</p>
          <dl className="dashboard-methodology-definitions">
            {RENEWAL_METRIC_DEFINITIONS.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.formula}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section id="method-anomaly" className="dashboard-methodology-section">
          <h3>GMV 异动诊断</h3>
          <p>
            异动使用动态阈值，10% 只是最低变化门槛，不是统一的固定阈值。大盘、Web、App 分别以各自支付结果中的总 GMV
            为监测对象，包含主动付费、自动续订和 API；主动付费、自动续订子项用于解释变化，不独立触发日诊断。
          </p>
          <p>
            每个端分别取最近 12 个完整业务周（周六至周五）的每日 GMV，形成“较前一日”和“较上周同日”两组历史变化率分布。
            每组分别计算上涨 P95 与下降
            P5，阈值随历史窗口滚动更新；计算规则相同，但各端、各比较方式、各方向的实际阈值可以不同。
          </p>
          <dl className="dashboard-methodology-definitions">
            <div>
              <dt>较前一日</dt>
              <dd>当日 GMV ÷ 前一日 GMV − 1；阈值使用该端历史的日变化率分布。</dd>
            </div>
            <div>
              <dt>较上周同日</dt>
              <dd>当日 GMV ÷ 7 天前 GMV − 1；阈值使用该端历史的上周同日变化率分布。</dd>
            </div>
            <div>
              <dt>上涨触发条件</dt>
              <dd>变化率 ≥ max（该端对应历史分布的 P95，+10%）。</dd>
            </div>
            <div>
              <dt>下降触发条件</dt>
              <dd>变化率 ≤ min（该端对应历史分布的 P5，−10%）。P5 即第 5 百分位数，也称 P05。</dd>
            </div>
            <div>
              <dt>如何判定</dt>
              <dd>任一比较方式触发即判为该端当日异动；两种比较同时触发时合并为一项，详情保留两条信号。</dd>
            </div>
          </dl>
          <p>
            因此，跌幅超过 10% 仍可能未触发。例如某端历史下降阈值为 −14.18%，当日下降 13.59% 就未触发。
            大盘是汇总后的独立序列，其波动分布不同，可能出现大盘触发而 Web、App 各自均未触发的情况。
          </p>
          <p>
            日历红圈、趋势红圈和右侧异动线索均按当前所选端展示，不能把大盘的异动标到 Web 或 App。
            数据缺失、比较基准无有效正值、完整业务周不足 12 个或有效变化率样本不足 8
            个时，等待监测数据，不将缺失判为无异动。
            日诊断任务与异动信号分开：某端触发时也会生成大盘汇总诊断作为上下文，这不表示大盘必然触发了自身阈值。
          </p>
        </section>
        <section id="method-payment" className="dashboard-methodology-section">
          <h3>支付结果与链路归因</h3>
          <dl className="dashboard-methodology-definitions">
            <div>
              <dt>付费类型表</dt>
              <dd>主动付费直接汇总支付结果；自动续订按支付日期汇总当日实际发生的续费 GMV。</dd>
            </div>
            <div>
              <dt>大盘 GMV</dt>
              <dd>包含主动付费、自动续订和 API 收入；API 单独列项，不纳入主动付费链路归因。</dd>
            </div>
            <div>
              <dt>续订表</dt>
              <dd>以到期用户为 cohort，观察这批用户后续是否续费及其续费金额，不按续费支付日重新归组。</dd>
            </div>
            <div>
              <dt>支付链路表</dt>
              <dd>主动付费从 DAU 出发，按访问、曝光、提交、支付的时间戳顺序归因；自动续订沿用到期用户 cohort。</dd>
            </div>
            <div>
              <dt>差额含义</dt>
              <dd>支付结果中未能被对应行为链路串联的部分，保留在结果口径中，不强行分配给某个驱动因子。</dd>
            </div>
          </dl>
        </section>
        <section id="method-creative" className="dashboard-methodology-section">
          <h3>创作积极性与分层</h3>
          <dl className="dashboard-methodology-definitions">
            <div>
              <dt>创作积极性</dt>
              <dd>创作 UV、任务数按业务日均展示，渗透率为创作 UV ÷ 活跃 UV，不计算贡献度。</dd>
            </div>
            <div>
              <dt>创作分层</dt>
              <dd>
                支付链路按统计日前 30
                日的有效创作任务数逐日划分；创作积极性侧证仍按原业务周窗口划分。“近30日无创作用户”仅表示对应历史窗口内创作次数为
                0，基准期与分析期分别按各自窗口划分；创作 UV、创作渗透率等指标统计的是这批用户在对应比较期内的行为。
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </article>
  );
}
