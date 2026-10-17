import * as Select from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';
import type { Platform } from '@shared/api.interface';

const OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: 'web', label: 'Web 端 · 业务周报' },
  { value: 'app', label: 'App 端 · 业务周报' },
];

export function ReportPlatformSelect({ value, onValueChange, className }: { value: Platform; onValueChange: (value: Platform) => void; className?: string }) {
  const current = OPTIONS.find(option => option.value === value) ?? OPTIONS[0];
  return (
    <Select.Root value={value} onValueChange={next => onValueChange(next as Platform)}>
      <Select.Trigger className={`report-platform-trigger${className ? ` ${className}` : ''}`} aria-label="报告端口">
        <Select.Value>{current.label}</Select.Value>
        <Select.Icon><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="report-platform-menu" position="popper" align="end" sideOffset={8} collisionPadding={16}>
          <Select.Viewport>
            {OPTIONS.map(({ value: optionValue, label }) => (
              <Select.Item key={optionValue} value={optionValue} className="report-platform-option">
                <Select.ItemText>{label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
