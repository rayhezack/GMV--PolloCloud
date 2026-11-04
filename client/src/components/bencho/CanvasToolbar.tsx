import { CalendarDays, Download, MoreHorizontal, RotateCcw, Table2 } from 'lucide-react';
import type { Granularity } from '@shared/api.interface';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function CanvasToolbar({ granularity, onGranularityChange, onResetRange, showData, onToggleData, onExport }: {
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  onResetRange: () => void;
  showData: boolean;
  onToggleData: () => void;
  onExport: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="图表工具栏">
      <Select value={granularity} onValueChange={value => onGranularityChange(value as Granularity)}>
        <SelectTrigger className="canvas-period-select" aria-label="趋势颗粒度"><CalendarDays size={15}/><SelectValue/></SelectTrigger>
        <SelectContent align="end" className="canvas-toolbar-menu border-0">
          <SelectItem value="day">日</SelectItem><SelectItem value="week">周</SelectItem><SelectItem value="month">月</SelectItem>
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="canvas-toolbar-tool" aria-label="更多图表操作"><MoreHorizontal size={18}/></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="canvas-toolbar-menu border-0">
          <DropdownMenuItem onSelect={onResetRange}><RotateCcw size={15}/>全部范围</DropdownMenuItem>
          <DropdownMenuItem onSelect={onToggleData}><Table2 size={15}/>{showData ? '收起明细' : '数据明细'}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport}><Download size={15}/>导出 CSV</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
