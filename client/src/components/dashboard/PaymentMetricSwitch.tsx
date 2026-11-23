import { Segment } from '@/components/v62/primitives';
import type { PaymentMetric } from '@shared/payment-metric';

export function PaymentMetricSwitch({ value, onChange, label = '付费分析指标' }: {
  value: PaymentMetric;
  onChange: (value: PaymentMetric) => void;
  label?: string;
}) {
  return <Segment label={label} variant="icons" value={value} onChange={onChange} items={[
    {value:'gmv',label:'GMV',icon:'banknote'},
    {value:'orders',label:'订单量',icon:'receipt'},
  ]} />;
}
