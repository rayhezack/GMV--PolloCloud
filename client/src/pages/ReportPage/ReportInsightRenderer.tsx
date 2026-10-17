import type { ComponentProps } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Copy } from 'lucide-react';
import { omit } from 'es-toolkit';
import { Streamdown } from '@/components/ui/streamdown';
import { copyAnalysis } from '@/components/dashboard/AnalysisWidgets';
import type { ReportSummary } from '@shared/api.interface';
import { formatGeneratedAt } from './report-page.utils';
import { ReportPlatformSelect } from './ReportPlatformSelect';
import type { Platform } from '@shared/api.interface';
import './report-reading.css';

type Section = { title: string; body: string };
function parseReport(markdown: string) {
  const content = markdown.trim().replace(/^#\s+[^\n]+\n/, '');
  const chunks = content.split(/^##\s+/m);
  const summary = chunks.shift()?.trim() || '';
  const sections: Section[] = chunks.map(chunk => {
    const end = chunk.indexOf('\n');
    return { title: chunk.slice(0, end).trim(), body: chunk.slice(end + 1).trim() };
  });
  return { summary, sections };
}
export function removeCreativeEvidenceTables(body: string): string {
  return body.split('\n').filter(line => !/^\s*\|.*\|\s*$/u.test(line)
    && !/CREATIVE_(?:ATOMIC|OVERALL)_TABLE/u.test(line)
    && !/创作积极性原子指标.*按创作分层列出/u.test(line)).join('\n').trim();
}
export function removeDefinitionParagraphs(body: string): string {
  return body.split(/\n\s*\n/).filter(paragraph => {
    const plainText = paragraph.trim().replace(/^\*\*/, '');
    return !/^口径说明[：:]/u.test(plainText);
  }).join('\n\n').trim();
}
export function emphasizeNarrativeMetrics(markdown: string): string {
  return markdown.split('\n').map(line => {
    if (/^\s*\|.*\|\s*$/u.test(line)) return line;
    return line.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/u).map(segment => {
      if (segment.startsWith('*')) return segment;
      return segment
        .replace(/([+\-−]\d+(?:\.\d+)?%)/gu, '*$1*')
        .replace(/((?:增加|减少|上升|下降|增长|收缩)\s+)(\$[\d,]+(?:\.\d+)?)/gu, '$1*$2*');
    }).join('');
  }).join('\n');
}
const components: NonNullable<ComponentProps<typeof Streamdown>['components']> = {
  table: ({ children, ...props }) => <div className="report-table-scroll" role="region" aria-label="诊断证据表格" tabIndex={0}><table {...omit(props, ['node'])}>{children}</table></div>,
};
function Markdown({ children }: { children: string }) {
  return <Streamdown className="report-prose" components={components}>{emphasizeNarrativeMetrics(children)}</Streamdown>;
}
function leadAndDetail(body: string) {
  const paragraphs = body.split(/\n\s*\n/);
  return { lead: paragraphs[0] || '', detail: paragraphs.slice(1).join('\n\n') };
}
function emphasizedLead(lead: string) {
  const normalized = lead.trim();
  const match = normalized.match(/^\*\*(.+?)\*\*\s*(.*)$/su);
  return match
    ? { judgment: match[1].trim(), context: match[2].trim() }
    : { judgment: normalized.replace(/\*\*/g, '').trim(), context: '' };
}
function formatSummary(summary: string) {
  const paragraphs = summary.replace(/\*\*/g, '')
    .replace(/[。；](?=在主动付费)/g, '。\n\n')
    .replace(/；(?=该分层)/g, '。\n\n');
  return paragraphs.split(/\n\s*\n/)
    .map(paragraph => `**${paragraph.trim()}**`)
    .join('\n\n');
}
const sectionTitle = (title: string) => title.replace(/^[一二三四五六七八九十]+[、．.]\s*/, '');
const normalizeReportNarrative = (markdown: string) => markdown.replace(/自动续订一级口径/g, '自动续订').replace(/一级口径/g, '');
const analysisWeekStart = (baselineStart: string) => new Date(Date.parse(`${baselineStart}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);

export function ReportInsightArticle({ report }: { report: ReportSummary }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { summary, sections } = parseReport(normalizeReportNarrative(report.markdown));
  const cause = sections.find(section => /原因诊断/.test(section.title));
  const advice = sections.find(section => /行动建议|优化建议|建议/.test(section.title));
  const evidence = sections.filter(section => section !== cause && section !== advice);
  const causeParts = leadAndDetail(cause?.body || '');
  return (
    <article className="report-reading" key={`${report.platform}-${report.periodStart}-${report.generatedAt}`}>
      <aside className="report-reading-rail">
        <div className="report-edition">
          <ReportPlatformSelect
            value={report.platform}
            className="report-reading-platform-select"
            onValueChange={(platform: Platform) => {
              const next = new URLSearchParams(searchParams);
              next.set('platform', platform);
              setSearchParams(next);
            }}
          />
          <strong>{analysisWeekStart(report.periodStart)}<br /><span className="report-date-to">至</span> {report.periodEnd}</strong>
        </div>
        <nav aria-label="报告目录">
          <a href="#report-conclusion">核心结论</a>
          {cause && <a href="#report-cause">原因判断</a>}
          <a href="#report-actions">行动建议</a>
          <a href="#report-evidence">数据与论证</a>
          <a href={`/?tab=data&platform=${report.platform}`}>数据口径</a>
        </nav>
        <p className="report-update">更新于<br />{formatGeneratedAt(report.generatedAt)}</p>
      </aside>
      <div className="report-reading-body">
        <section id="report-conclusion" className="report-conclusion">
          <div className="report-section-heading"><h2>核心结论</h2><button aria-label="复制核心结论" title="复制核心结论" onClick={() => void copyAnalysis(summary)}><Copy size={16} /></button></div>
          <Markdown>{formatSummary(summary)}</Markdown>
        </section>
        {cause && <section id="report-cause" className="report-reading-section">
          <h2>原因判断</h2>
          <Markdown>{causeParts.lead.replace(/^(\*\*)?核心判断[：:]\s*/, '$1')}</Markdown>
          {causeParts.detail && <details className="report-inline-detail"><summary>查看原因论证<ChevronDown size={15} /></summary><Markdown>{causeParts.detail}</Markdown></details>}
        </section>}
        <section id="report-actions" className="report-reading-section">
          <h2>行动建议</h2>
          {advice ? <Markdown>{advice.body}</Markdown> : <p className="report-history-note">这份历史报告未包含行动建议。重新生成后，将结合该业务周的诊断补充建议。</p>}
        </section>
        <section id="report-evidence" className="report-reading-section report-evidence">
          <h2>数据与论证</h2>
          <p className="report-evidence-caption">展开查看支撑结论的指标变化与归因明细。</p>
          {evidence.map((section, index) => {
            const body = removeDefinitionParagraphs(
              /创作积极性|创作侧/.test(section.title) ? removeCreativeEvidenceTables(section.body) : section.body,
            );
            const { lead, detail } = leadAndDetail(body);
            const { judgment, context } = emphasizedLead(lead);
            return <details className="report-evidence-item" key={`${section.title}-${index}`}>
              <summary><span><strong>{sectionTitle(section.title)}</strong><span className="report-evidence-lead"><strong>{judgment}</strong>{context && <> {context}</>}</span></span><ChevronDown size={18} /></summary>
              <Markdown>{detail || body}</Markdown>
            </details>;
          })}
        </section>
      </div>
    </article>
  );
}
