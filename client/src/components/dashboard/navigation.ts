import {
  Activity,
  CreditCard,
  GitBranch,
  Zap,
  FileText,
  Database,
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
    label: '支付链路 × 分层',
    description: '从创作分层下钻，识别支付链路的变化来源。',
    icon: GitBranch,
  },
  {
    id: 'creative',
    label: '创作积极性',
    description: '对照创作活跃变化，作为业务诊断的侧证。',
    icon: Zap,
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
    description: '核对数据状态、覆盖差异和指标定义。',
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
