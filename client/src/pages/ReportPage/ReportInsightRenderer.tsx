import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useState,
} from 'react';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { copyAnalysis } from '@/components/dashboard/AnalysisWidgets';
import { Copy } from 'lucide-react';
import { omit } from 'es-toolkit';
import { Streamdown } from '@client/src/components/ui/streamdown';
import { cn } from '@client/src/lib/utils';
import type { Platform, ReportSummary } from '@shared/api.interface';
import { formatGeneratedAt } from './report-page.utils';

const PLATFORM_LABELS: Record<Platform, string> = {
  web: 'Web 端',
  app: 'App 端',
};
const SIGNED_PERCENT_PATTERN = /([+＋\-−]\d+(?:\.\d+)?%)/gu;

type ReportMarkdownComponents = NonNullable<
  ComponentProps<typeof Streamdown>['components']
>;

type ReportMarkdownVariant = 'body' | 'summary' | 'callout';

interface ParsedReportSection {
  title: string;
  body: string;
}

interface ParsedReportMarkdown {
  title: string;
  summary: string;
  sections: ParsedReportSection[];
}

interface MarkdownAstNode {
  tagName?: string;
  value?: string;
  children?: MarkdownAstNode[];
}

interface TableRenderContextValue {
  numericColumns: Set<number> | null;
  contributionColumns: Set<number>;
  contributionMaxByColumn: Map<number, number>;
}

const TableRenderContext = createContext<TableRenderContextValue | null>(null);

function normalizeLegacyCreativeTierWording(markdown: string): string {
  return markdown
    .replace(
      /(?:近30日未创作|未创作)(?:分层|人群|用户)?的?(创作UV|创作数量|创作渗透率|人均创作数量)/gu,
      '分析期前30日无创作用户在分析期内的$1',
    )
    .replace(
      /(?:近30日未创作|未创作)(?:分层|人群|用户)/gu,
      '分析期前30日无创作用户',
    );
}

function parseReportMarkdown(markdown: string): ParsedReportMarkdown {
  const lines = normalizeLegacyCreativeTierWording(markdown)
    .trim()
    .split(/\r?\n/u);
  const titleLine = lines[0]?.match(/^#\s+(.+)$/u);
  const title = titleLine?.[1]?.trim() || 'GMV 诊断归因';
  const contentLines = titleLine ? lines.slice(1) : lines;
  const firstSectionIndex = contentLines.findIndex((line) =>
    /^##\s+/.test(line),
  );
  const summaryLines =
    firstSectionIndex >= 0
      ? contentLines.slice(0, firstSectionIndex)
      : contentLines;
  const sectionLines =
    firstSectionIndex >= 0 ? contentLines.slice(firstSectionIndex) : [];
  const sections: ParsedReportSection[] = [];
  let currentSection: { title: string; lines: string[] } | null = null;

  sectionLines.forEach((line) => {
    const heading = line.match(/^##\s+(.+)$/u);
    if (heading) {
      if (currentSection) {
        sections.push({
          title: currentSection.title,
          body: currentSection.lines.join('\n').trim(),
        });
      }
      currentSection = { title: heading[1].trim(), lines: [] };
      return;
    }
    currentSection?.lines.push(line);
  });

  if (currentSection) {
    sections.push({
      title: currentSection.title,
      body: currentSection.lines.join('\n').trim(),
    });
  }

  return {
    title,
    summary: summaryLines.join('\n').trim(),
    sections,
  };
}

function getSignedValueTone(value: string): 'positive' | 'negative' {
  return /^[+＋]/u.test(value) ? 'positive' : 'negative';
}

function ChangeBadge({ value }: { value: string }) {
  const tone = getSignedValueTone(value);
  return (
    <span
      className={cn(
        'mx-1 inline-flex items-center rounded-full px-2.5 py-0.5 align-baseline text-sm font-bold tabular-nums',
        tone === 'positive'
          ? 'bg-green-50 text-green-700'
          : 'bg-red-50 text-red-700',
      )}
    >
      {value}
    </span>
  );
}

function renderSignedPercentBadges(text: string): ReactNode {
  const pieces: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(SIGNED_PERCENT_PATTERN)) {
    const value = match[1];
    const index = match.index ?? 0;
    const prefix = text.slice(Math.max(0, index - 12), index);
    if (index > lastIndex) pieces.push(text.slice(lastIndex, index));
    if (/贡献度\s*$/u.test(prefix)) {
      pieces.push(value);
    } else {
      pieces.push(<ChangeBadge key={`${value}-${index}`} value={value} />);
    }
    lastIndex = index + value.length;
  }
  if (lastIndex < text.length) pieces.push(text.slice(lastIndex));
  return pieces.length > 0 ? pieces : text;
}

function renderTextWithBadges(node: ReactNode): ReactNode {
  if (typeof node === 'string') return renderSignedPercentBadges(node);
  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{renderTextWithBadges(child)}</Fragment>
    ));
  }
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (!element.props.children) return node;
  return cloneElement(
    element,
    undefined,
    renderTextWithBadges(element.props.children),
  );
}

function getAstText(node: MarkdownAstNode | undefined): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  return node.children?.map((child) => getAstText(child)).join('') ?? '';
}

function findFirstTableRow(
  node: MarkdownAstNode | undefined,
): MarkdownAstNode | null {
  if (!node) return null;
  if (node.tagName === 'tr') return node;
  for (const child of node.children ?? []) {
    const row = findFirstTableRow(child);
    if (row) return row;
  }
  return null;
}

function collectTableRows(
  node: MarkdownAstNode | undefined,
  rows: MarkdownAstNode[] = [],
): MarkdownAstNode[] {
  if (!node) return rows;
  if (node.tagName === 'tr') rows.push(node);
  node.children?.forEach((child) => collectTableRows(child, rows));
  return rows;
}

function getRowCellTexts(row: MarkdownAstNode | undefined): string[] {
  return (
    row?.children
      ?.filter((child) => child.tagName === 'th' || child.tagName === 'td')
      .map((child) => getAstText(child).trim()) ?? []
  );
}

function getTableHeaderTexts(node: unknown): string[] {
  const tableNode = node as MarkdownAstNode | undefined;
  const firstRow = findFirstTableRow(tableNode);
  return getRowCellTexts(firstRow ?? undefined);
}

function isNumericTableHeader(header: string): boolean {
  if (!header) return false;
  if (/指标|分层|类型|端口|维度|说明|原因|板块|日期/u.test(header)) {
    return false;
  }
  return /均值|周环比|变化率|贡献度|增量|GMV|DAU|UV|率|客单价|金额|基准期|分析期/u.test(
    header,
  );
}

function getTableNumericColumns(node: unknown): Set<number> | null {
  const headers = getTableHeaderTexts(node);
  if (headers.length === 0) return null;
  const indexes = headers
    .map((header, index) => (isNumericTableHeader(header) ? index : -1))
    .filter((index) => index >= 0);
  return new Set(indexes);
}

function getTableContributionColumns(node: unknown): Set<number> {
  const headers = getTableHeaderTexts(node);
  return new Set(
    headers
      .map((header, index) => (/贡献度/u.test(header) ? index : -1))
      .filter((index) => index >= 0),
  );
}

function parsePercentNumber(value: string): number | null {
  const match = value.match(/([+＋\-−]?\d+(?:\.\d+)?)%/u);
  if (!match) return null;
  const normalized = match[1].replace(/＋/gu, '+').replace(/−/gu, '-');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function getContributionMaxByColumn(
  node: unknown,
  contributionColumns: Set<number>,
): Map<number, number> {
  const tableNode = node as MarkdownAstNode | undefined;
  const rows = collectTableRows(tableNode).slice(1);
  const maxByColumn = new Map<number, number>();

  contributionColumns.forEach((columnIndex) => {
    const values = rows
      .map((row) => parsePercentNumber(getRowCellTexts(row)[columnIndex] ?? ''))
      .filter((value): value is number => value !== null)
      .map((value) => Math.abs(value));
    maxByColumn.set(columnIndex, values.length > 0 ? Math.max(...values) : 0);
  });

  return maxByColumn;
}

function getReactNodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(getReactNodeText).join('');
  if (!isValidElement(node)) return '';
  const element = node as ReactElement<{ children?: ReactNode }>;
  return getReactNodeText(element.props.children);
}

function getReportColumnIndex(props: Record<string, unknown>): number | null {
  const value = props['data-report-column-index'];
  return typeof value === 'number' ? value : null;
}

function useShouldRightAlignColumn(columnIndex: number | null): boolean {
  const tableContext = useContext(TableRenderContext);
  if (columnIndex === null) return false;
  if (!tableContext?.numericColumns) return columnIndex > 0;
  return tableContext.numericColumns.has(columnIndex);
}

function useContributionColumnContext(columnIndex: number | null) {
  const tableContext = useContext(TableRenderContext);
  if (
    columnIndex === null ||
    !tableContext?.contributionColumns.has(columnIndex)
  ) {
    return null;
  }
  return {
    maxAbsValue: tableContext.contributionMaxByColumn.get(columnIndex) ?? 0,
  };
}

type ReportTableHeaderCellProps = ComponentProps<'th'> & {
  node?: unknown;
  'data-report-column-index'?: number;
};

type ReportTableDataCellProps = ComponentProps<'td'> & {
  node?: unknown;
  'data-report-column-index'?: number;
};

function ReportTableHeaderCell({
  className,
  children,
  ...props
}: ReportTableHeaderCellProps) {
  const columnIndex = getReportColumnIndex(props as Record<string, unknown>);
  const rightAlign = useShouldRightAlignColumn(columnIndex);
  const domProps = omit(props as Record<string, unknown>, [
    'node',
    'data-report-column-index',
  ]);
  return (
    <th
      className={cn(
        'whitespace-nowrap px-4 py-4 text-xs font-semibold text-gray-900',
        rightAlign ? 'text-right tabular-nums' : 'text-left',
        className,
      )}
      {...(domProps as ComponentProps<'th'>)}
    >
      {children}
    </th>
  );
}

function ReportTableDataCell({
  className,
  children,
  ...props
}: ReportTableDataCellProps) {
  const columnIndex = getReportColumnIndex(props as Record<string, unknown>);
  const rightAlign = useShouldRightAlignColumn(columnIndex);
  const contributionContext = useContributionColumnContext(columnIndex);
  const domProps = omit(props as Record<string, unknown>, [
    'node',
    'data-report-column-index',
  ]);

  if (contributionContext) {
    return (
      <td
        className={cn(
          'whitespace-nowrap px-4 py-4 align-middle text-sm text-gray-700',
          rightAlign ? 'text-right tabular-nums' : 'text-left',
          className,
        )}
        {...(domProps as ComponentProps<'td'>)}
      >
        <ContributionValue
          value={getReactNodeText(children)}
          maxAbsValue={contributionContext.maxAbsValue}
        />
      </td>
    );
  }

  return (
    <td
      className={cn(
        'whitespace-nowrap px-4 py-4 align-middle text-sm text-gray-700',
        rightAlign ? 'text-right tabular-nums' : 'text-left',
        className,
      )}
      {...(domProps as ComponentProps<'td'>)}
    >
      {children}
    </td>
  );
}

function ContributionValue({
  value,
  maxAbsValue,
}: {
  value: string;
  maxAbsValue: number;
}) {
  const percentValue = parsePercentNumber(value);
  if (percentValue === null) {
    return <span>{value}</span>;
  }

  const magnitude = Math.abs(percentValue);
  const width =
    maxAbsValue > 0 && magnitude > 0
      ? Math.max(6, Math.min(100, (magnitude / maxAbsValue) * 100))
      : 0;
  const isPositive = percentValue >= 0;

  return (
    <div className="ml-auto flex w-36 flex-col items-end gap-1.5">
      <span className="font-medium text-gray-700">{value}</span>
      <div className="grid h-1.5 w-full grid-cols-2 gap-px" aria-hidden="true">
        <span className="relative h-full overflow-hidden rounded-l-full bg-gray-200">
          {!isPositive && width > 0 ? (
            <span
              className="absolute right-0 top-0 h-full rounded-l-full bg-red-500"
              style={{ width: `${width}%` }}
            />
          ) : null}
        </span>
        <span className="relative h-full overflow-hidden rounded-r-full bg-gray-200">
          {isPositive && width > 0 ? (
            <span
              className="absolute left-0 top-0 h-full rounded-r-full bg-primary"
              style={{ width: `${width}%` }}
            />
          ) : null}
        </span>
      </div>
    </div>
  );
}

function createReportMarkdownComponents(
  variant: ReportMarkdownVariant,
): ReportMarkdownComponents {
  const paragraphTone =
    variant === 'summary'
      ? 'text-gray-800'
      : variant === 'callout'
        ? 'text-gray-700'
        : 'text-gray-700';
  const strongTone = 'text-gray-900';
  const strongWeight = 'font-semibold';

  return {
    p: ({ className, children, ...props }) => (
      <p
        className={cn(
          'mb-4 w-full text-sm leading-relaxed last:mb-0',
          paragraphTone,
          className,
        )}
        {...omit(props, ['node'])}
      >
        {renderTextWithBadges(children)}
      </p>
    ),
    strong: ({ className, children, ...props }) => (
      <strong
        className={cn(strongWeight, strongTone, className)}
        {...omit(props, ['node'])}
      >
        {renderTextWithBadges(children)}
      </strong>
    ),
    ol: ({ className, ...props }) => (
      <ol
        className={cn(
          'my-5 list-decimal space-y-4 pl-5 text-sm leading-relaxed text-gray-700',
          className,
        )}
        {...omit(props, ['node'])}
      />
    ),
    ul: ({ className, ...props }) => (
      <ul
        className={cn(
          'my-5 list-disc space-y-3 pl-5 text-sm leading-relaxed text-gray-700',
          className,
        )}
        {...omit(props, ['node'])}
      />
    ),
    li: ({ className, children, ...props }) => (
      <li
        className={cn('pl-1 marker:text-gray-400', className)}
        {...omit(props, ['node'])}
      >
        {renderTextWithBadges(children)}
      </li>
    ),
    h3: ({ className, children, ...props }) => (
      <h3
        className={cn(
          'mt-8 mb-3 text-lg font-semibold tracking-tight text-gray-900',
          className,
        )}
        {...omit(props, ['node'])}
      >
        {renderTextWithBadges(children)}
      </h3>
    ),
    h4: ({ className, children, ...props }) => (
      <h4
        className={cn(
          'mt-6 mb-2 text-base font-semibold text-gray-900',
          className,
        )}
        {...omit(props, ['node'])}
      >
        {renderTextWithBadges(children)}
      </h4>
    ),
    table: ({ className, ...props }) => {
      const tableNode = (props as { node?: unknown }).node;
      const numericColumns = getTableNumericColumns(tableNode);
      const contributionColumns = getTableContributionColumns(tableNode);
      const contributionMaxByColumn = getContributionMaxByColumn(
        tableNode,
        contributionColumns,
      );
      return (
        <TableRenderContext.Provider
          value={{
            numericColumns,
            contributionColumns,
            contributionMaxByColumn,
          }}
        >
          <div className="not-prose my-6 overflow-hidden rounded-2xl bg-gray-50">
            <div className="overflow-x-auto">
              <table
                className={cn(
                  'w-full min-w-[760px] border-collapse text-sm [&_tbody_tr]:border-b [&_tbody_tr]:border-gray-100 [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr:hover]:bg-white [&_tbody_tr:last-child]:border-b-0',
                  className,
                )}
                {...omit(props, ['node'])}
              />
            </div>
          </div>
        </TableRenderContext.Provider>
      );
    },
    thead: ({ className, ...props }) => (
      <thead
        className={cn('bg-transparent', className)}
        {...omit(props, ['node'])}
      />
    ),
    tbody: ({ className, ...props }) => (
      <tbody className={cn(className)} {...omit(props, ['node'])} />
    ),
    tr: ({ className, children, ...props }) => (
      <tr className={cn(className)} {...omit(props, ['node'])}>
        {Children.map(children, (child, index) => {
          if (!isValidElement(child)) return child;
          return cloneElement(child as ReactElement<Record<string, unknown>>, {
            'data-report-column-index': index,
          });
        })}
      </tr>
    ),
    th: ReportTableHeaderCell,
    td: ReportTableDataCell,
  };
}

function ReportMarkdown({
  children,
  className,
  variant = 'body',
}: {
  children: string;
  className?: string;
  variant?: ReportMarkdownVariant;
}) {
  return (
    <Streamdown
      className={cn('max-w-none', className)}
      components={createReportMarkdownComponents(variant)}
    >
      {children}
    </Streamdown>
  );
}

function ReportHero({
  parsed,
  report,
}: {
  parsed: ParsedReportMarkdown;
  report: ReportSummary;
}) {
  return (
    <section className="report-hero rounded-3xl bg-white p-5 shadow-[0_18px_50px_rgba(38,56,58,0.06)] md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <span className="rounded-full bg-[#edf2f0] px-3 py-1 text-sm font-medium text-[#405a56]">
          {PLATFORM_LABELS[report.platform] ?? report.platform}
        </span>
        {report.degraded ? (
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
            降级生成
          </span>
        ) : null}
      </div>

      {parsed.summary ? (
        <div className="mt-6">
          <ReportMarkdown className="text-gray-800" variant="summary">
            {parsed.summary}
          </ReportMarkdown>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-5">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          数据周期 {report.periodStart} ~ {report.periodEnd}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          生成时间 {formatGeneratedAt(report.generatedAt)}
        </span>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          模型 {report.modelUsed}
        </span>
      </div>
    </section>
  );
}

function isCauseSection(title: string): boolean {
  return /原因诊断|真因诊断/u.test(title);
}

function isCreativeSection(title: string): boolean {
  return /创作积极性|创作侧/u.test(title);
}

function ReportSectionCard({ section }: { section: ParsedReportSection }) {
  const causeSection = isCauseSection(section.title);
  const creativeSection = isCreativeSection(section.title);

  return (
    <section className="rounded-3xl bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.05)] md:p-8">
      <h2 className="text-2xl font-medium tracking-tight text-gray-900">
        {section.title}
      </h2>
      {creativeSection ? (
        <div className="mt-5 rounded-2xl border border-accent bg-accent/70 px-5 py-4 text-sm leading-6 text-gray-700">
          <span className="font-semibold text-accent-foreground">口径说明：</span>
          创作分层按分析期开始前30日的创作次数划分；“分析期前30日无创作用户”
          仅表示该窗口内创作次数为0。下方创作UV、创作渗透率等指标统计的是这批用户在分析期内的行为，不代表他们在分析期内没有创作。
        </div>
      ) : null}
      {section.body ? (
        causeSection ? (
          <div className="mt-6 rounded-2xl border-l-4 border-primary bg-accent px-6 py-5">
            <ReportMarkdown variant="callout">{section.body}</ReportMarkdown>
          </div>
        ) : (
          <div className="mt-6">
            <ReportMarkdown>{section.body}</ReportMarkdown>
          </div>
        )
      ) : null}
    </section>
  );
}

export function ReportInsightArticle({ report }: { report: ReportSummary }) {
  const parsed = parseReportMarkdown(report.markdown);
  const [summaryOnly, setSummaryOnly] = useState(false);

  return (
    <article className="flex flex-col gap-8">
      <div className="report-toolbar">
        <div className="chart-actions" aria-label="报告阅读模式">
          <button
            aria-pressed={!summaryOnly}
            onClick={() => setSummaryOnly(false)}
          >
            完整报告
          </button>
          <button
            aria-pressed={summaryOnly}
            onClick={() => setSummaryOnly(true)}
          >
            只看摘要
          </button>
        </div>
        <button
          className="text-xs text-slate-500 flex items-center gap-1.5"
          onClick={() => void copyAnalysis(parsed.summary)}
        >
          <Copy size={13} />
          复制核心结论
        </button>
      </div>
      <ReportHero parsed={parsed} report={report} />
      {!summaryOnly &&
        parsed.sections.map((section, index) => (
          <details
            className="report-section-fold"
            key={`${section.title}-${index}`}
            open
          >
            <summary>{section.title}</summary>
            <ReportSectionCard section={section} />
          </details>
        ))}
    </article>
  );
}
