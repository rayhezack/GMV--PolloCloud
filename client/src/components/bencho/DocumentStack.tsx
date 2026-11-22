import { useId, useState, type Ref } from 'react';
import './DocumentStack.css';

export type StackDocument = { id: string; title: string; ariaLabel?: string };

/** Local document picker. Fetching, task state and the document reader belong to the caller. */
export function DocumentStack({ title = 'Documents', date, documents, emptyLabel = 'No documents', onOpen, onEmptyClick, coverRef }: {
  title?: string; date?: string; documents: StackDocument[]; emptyLabel?: string;
  onOpen: (id: string) => void; onEmptyClick?: () => void; coverRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = documents.length > 0 && (hovered || pinned || focused);
  return <div className="bencho-document-stack" data-expanded={expanded} data-count={documents.length} role="group" aria-label={title}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={event => setFocused((event.target as HTMLElement).matches(':focus-visible'))}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false); }}
    onKeyDown={event => { if (event.key === 'Escape') { setPinned(false); setHovered(false); setFocused(false); } }}>
    <button ref={coverRef} type="button" className="bencho-document-cover" aria-expanded={expanded} aria-controls={id}
      onClick={() => documents.length ? setPinned(value => !value) : onEmptyClick?.()}
      aria-label={`${title}，${documents.length ? `${documents.length}份报告，展开选择` : emptyLabel}`}>
      <span className="bencho-document-cover-heading"><strong>{title}</strong>{date && <time dateTime={date}>{date.slice(5).replace('-', '/')}</time>}</span>
      <span className="bencho-document-cover-count">{documents.length ? <><b>{documents.length}</b> 份报告</> : emptyLabel}</span>
    </button>
    <div id={id} className="bencho-document-papers">
      {documents.map((document, index) => <button key={document.id} type="button" className="bencho-document-paper" data-layer={documents.length - index}
        tabIndex={expanded ? 0 : -1} onClick={() => onOpen(document.id)} aria-label={document.ariaLabel || `打开${document.title}`}>
        <span className="bencho-document-paper-title">{document.title}</span>
        <span className="bencho-document-paper-lines" aria-hidden="true"><i /><i /><i /><i /></span>
      </button>)}
    </div>
  </div>;
}
