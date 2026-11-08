import { Check } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal } from '@/components/ui/dropdown-menu';
import './creative-pay-tier-picker.css';

export function CreativePayTierPicker({group,tier,tiers,onChange,disabled=false}:{group:string;tier:string;tiers:string[];onChange:(group:string,tier:string)=>void;disabled?:boolean}) {
  const tierLabel=(value:string)=>value==='(1000,+inf)'?'(1000+)':value;
  const label=group==='all'?'全部付费分层':group==='unpaid'?'未付费':tier==='all'?'付费':tierLabel(tier);
  const item=(value:string,text:string,selected:boolean,choose:()=>void)=><DropdownMenuItem key={value} className="creative-tier-option" onSelect={choose}>{text}{selected&&<Check size={14}/>}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="creative-tier-trigger" aria-label="功能30日付费分层" disabled={disabled}>{label}</button></DropdownMenuTrigger><DropdownMenuContent className="creative-tier-menu" align="end" sideOffset={6}>
    {item('all','全部付费分层',group==='all',()=>onChange('all','all'))}
    {item('unpaid','未付费',group==='unpaid',()=>onChange('unpaid','all'))}
    <DropdownMenuSub><DropdownMenuSubTrigger className="creative-tier-option" onClick={()=>onChange('paid',tier)}>付费{group==='paid'&&<Check size={14}/>}</DropdownMenuSubTrigger><DropdownMenuPortal><DropdownMenuSubContent className="creative-tier-menu" sideOffset={6}>
      {item('all','全部付费',group==='paid'&&tier==='all',()=>onChange('paid','all'))}
      {tiers.map(value=>item(value,tierLabel(value),group==='paid'&&tier===value,()=>onChange('paid',value)))}
    </DropdownMenuSubContent></DropdownMenuPortal></DropdownMenuSub>
  </DropdownMenuContent></DropdownMenu>;
}
