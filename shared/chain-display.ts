import { compareChainGroupKeys, type ChainGroup } from './chain-comparison.ts';

export const SMALL_SAMPLE_PEOPLE = 100;
/** Group GMV is never used as a population count. Read the chain's count factor. */
export function chainGroupRows(groups: ChainGroup[], factorKey: string, chainType: 'active'|'renewal') {
  return [...groups].sort((a,b)=>compareChainGroupKeys(a.key,b.key,chainType)).map(group=>{
    const factor = group.factors.find(f=>f.key===factorKey);
    const people = group.factors.find(f=>f.key===(chainType==='active'?'activeUv':'expireUserCnt'));
    const [tier, lifecycle = ''] = group.label.split(' × ');
    const small = factor?.effect == null || (people?.baseline != null && people.current != null && people.baseline < SMALL_SAMPLE_PEOPLE && people.current < SMALL_SAMPLE_PEOPLE);
    return { ...group, factor, tier, lifecycle, small };
  });
}
export function groupedTierLabels<T extends {tier:string}>(rows:T[]) {
  let previous = '';
  return rows.map(row=>{const showTier=row.tier!==previous;previous=row.tier;return {...row,showTier};});
}
