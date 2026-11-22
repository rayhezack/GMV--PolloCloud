import type { ReactNode } from 'react';
import { InfoTip as AstryxInfoTip } from '@astryxdesign/core/InfoTip';
/** <InfoTip label="GMV 口径">按支付成功日期统计。</InfoTip> */
export function InfoTip({ children, label = '口径说明' }: { children: ReactNode; label?: string }) {
  return <AstryxInfoTip size="xsm" label={label} content={children} />;
}
