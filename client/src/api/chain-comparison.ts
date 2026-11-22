import { apiRequest } from '@/lib/pollocloud';
import { createRequestCache } from './request-cache';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import type { ChainComparison, ChainComparisonParams } from '@shared/chain-comparison';
export type { ChainComparison } from '@shared/chain-comparison';
const cache = createRequestCache();
export async function getChainComparison(params: ChainComparisonParams & { revision?: number }): Promise<ChainComparison> {
  if (STATIC_DEMO_MODE) return { ready:false,reason:'示例数据未提供可验证的单日链路原子数据',source:'demo',comparison:params,dates:{baseline:[],analysis:[]},total:null,residual:null,factors:[],groups:[],trend:[] };
  const query=new URLSearchParams(Object.entries(params).filter(([,value])=>value!=null).map(([key,value])=>[key,String(value)]));
  const url=`/api/dashboard/chain-comparison?${query}`;
  return (await cache.read(url,()=>apiRequest<ChainComparison>(url))).data;
}
