import { useEffect, useState } from 'react';
import { getDailyDiagnosis, regenerateDailyDiagnosis } from '@/api/daily-diagnosis';
import type { DailyDiagnosisStatus as Status, DashboardPlatform } from '@shared/api.interface';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Streamdown } from '@/components/ui/streamdown';
import { ReportInsightArticle } from '@/pages/ReportPage/ReportInsightRenderer';
const labels = {waiting:'等待完整数据',queued:'诊断排队中',running:'正在诊断',success:'诊断已更新',failed:'诊断失败',clear:'异动已解除',normal:'未触发 GMV 异动'};
// Exact first paragraph written by the model; never synthesize or truncate a business conclusion.
export function dailyConclusion(markdown: string) {
  return markdown.trim().replace(/^#\s+[^\n]+\n/, '').trim().split(/\n\s*\n/)[0];
}
export default function DailyDiagnosisStatus({platform,period,refreshToken,canManage=false}:{platform:DashboardPlatform;period:string;refreshToken:number;canManage?:boolean}) {
  const [status,setStatus]=useState<Status|null>(null), [error,setError]=useState(''),[open,setOpen]=useState(false),[submitting,setSubmitting]=useState(false);
  useEffect(()=>{
    let active=true;
    const load=()=>getDailyDiagnosis(platform,period||undefined).then(value=>{if(active){setStatus(value);setError('');}}).catch(()=>{if(active)setError('诊断状态暂不可用');});
    setStatus(null);void load();
    const timer=window.setInterval(()=>void load(),15000);
    return ()=>{active=false;window.clearInterval(timer);};
  },[platform,period,refreshToken]);
  const retry=async()=>{
    if(!status?.period)return;
    setSubmitting(true);
    try{setStatus(await regenerateDailyDiagnosis(platform,status.period));setError('');}catch(e){setError(e instanceof Error?e.message:'提交失败，请重试');}finally{setSubmitting(false);}
  };
  if(status?.status==='normal' && !error) return null;
  return <div className="daily-diagnosis" aria-live="polite">
    <p className="daily-muted">{error || (status?labels[status.status]:'读取诊断状态…')}</p>
    {status?.status==='success' && status.report && <Streamdown className="report-prose daily-diagnosis-conclusion">{dailyConclusion(status.report.markdown)}</Streamdown>}
    {status?.error && <p className="daily-muted">{status.error}</p>}
    <div className="daily-guide-actions">
      {status?.report && <Button size="sm" variant="ghost" onClick={()=>setOpen(true)}>{status.status==='success'?'查看诊断':'查看历史诊断'}</Button>}
      {canManage && status && ['failed','success'].includes(status.status) && <Button size="sm" variant="ghost" disabled={submitting} onClick={()=>void retry()}>{status.status==='failed'?'重试诊断':'重新生成'}</Button>}
    </div>
    {status?.report && <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="daily-diagnosis-dialog">
        <DialogHeader><DialogTitle>{({all:'大盘',web:'Web',app:'App'})[platform]} · {status.period} 日异动诊断</DialogTitle><DialogDescription>{status.report.generatedAt} 生成{status.status!=='success'?' · 历史版本，当前状态以卡片为准':''}</DialogDescription></DialogHeader>
        <ReportInsightArticle report={status.report} mode="day" />
      </DialogContent>
    </Dialog>}
  </div>;
}
