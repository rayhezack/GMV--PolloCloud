import {
  Activity,
  CreditCard,
  GitBranch,
  Zap,
  FileText,
  Database,
  Megaphone,
} from 'lucide-react';

export const DASHBOARD_VIEWS = [
  {
    id: 'trend',
    label: 'GMV 趋势',
    description: '从总体趋势出发，定位收入变化。',
    icon: Activity,
  },
  {
    id: 'payment',
    label: '付费类型',
    description: '查看主动付费与自动续订的增量贡献。',
    icon: CreditCard,
  },
  {
    id: 'chain',
    label: '支付链路归因',
    description: '从 GMV 驱动下钻到支付漏斗、国家结构与渠道效率。',
    icon: GitBranch,
  },
  {
    id: 'creative',
    label: '创作积极性',
    description: '创作 UV、任务数按业务日均展示，渗透率为创作 UV ÷ 活跃 UV；分层按分析期开始前 30 日创作次数划分。',
    icon: Zap,
  },
  {
    id: 'ads',
    label: '广告侧看板',
    description: '从国家结构继续查看广告点击变化。',
    icon: Megaphone,
  },
  {
    id: 'report',
    label: '诊断报告',
    description: '从核心结论到证据，回溯完整业务周的变化。',
    icon: FileText,
  },
  {
    id: 'data',
    label: '数据与口径',
    description: '先看覆盖差异，再核对统计窗口和各指标定义。',
    icon: Database,
  },
] as const;

export function dashboardView(pathname: string, search: string) {
  const id = pathname.endsWith('/report')
    ? 'report'
    : new URLSearchParams(search).get('tab');
  return DASHBOARD_VIEWS.find((view) => view.id === id) ?? DASHBOARD_VIEWS[0];
}

export function dashboardHref(id: string, search: string) {
  const params = new URLSearchParams(search);
  params.set('tab', id);
  if (id === 'report' && params.get('platform') === 'all') {
    params.set('platform', 'web');
  }
  if (id === 'trend') {
    params.set('metric', 'activeGmv');
  }
  return `${id === 'report' ? '/report' : '/'}?${params.toString()}`;
}
