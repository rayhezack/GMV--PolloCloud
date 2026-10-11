import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import './ProgressTicks.css';

/* ── C · tick chart, hover to scrub ────────────────────── */
const TICKS = 34;
/* ── C · progress ticks ─────────────────────────────────────
   Two numbers and a row of ticks, and nothing else.

   It used to carry a title, a status chip, a sentence of
   encouragement and a delta pill — four pieces of text
   explaining a bar that was already explaining itself. Every
   one of them was there because the block felt thin without
   them, which is the wrong reason to write a word: a
   component that needs a caption to feel finished is a
   component that has not finished.

   What is left is what the ticks cannot say on their own —
   the value, and the fact that scrubbing is a preview rather
   than a commitment. The delta only exists while you are
   scrubbing, because at rest there is nothing to be different
   from. */
export function ProgressTicks({ committed = 66 }: { committed?: number }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const shown = cursor === null ? committed : Math.round(((cursor + 1) / TICKS) * 100);
  const filled = Math.round((shown / 100) * TICKS);
  const delta = shown - committed;

  /* ── THE ROW READS THE POINTER, THE TICKS DO NOT ─────────
     Every tick used to carry its own onPointerEnter, which is
     the obvious way to write this and works only with a mouse.
     A touch is captured to whatever it started on: drag your
     finger the length of the row and the browser keeps sending
     every event to the first tick you happened to land on, so
     enter never fires on any of the others and the scrubber
     sits still. It is not that the events are missing — they
     are all being delivered to the wrong element.

     One handler on the row, and the index comes from where the
     pointer actually is. That is the same answer for a mouse
     crossing tick 12 and a finger dragging over it, so the two
     stop being separate code paths. */
  const row = useRef<HTMLDivElement | null>(null);
  const down = useRef(false);

  const at = (clientX: number) => {
    const bounds = row.current?.getBoundingClientRect();
    if (!bounds || !bounds.width) return null;
    const index = Math.floor(((clientX - bounds.left) / bounds.width) * TICKS);
    return Math.min(TICKS - 1, Math.max(0, index));
  };

  /* ── one mark per tick crossed, not one per event ──────── */
  const to = (index: number | null) => setCursor(index);
  const track = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && !down.current) return;
    to(at(event.clientX));
  };

  return (
    <div className="bencho-progress-ticks" aria-label="主动付费进度预览">
      <div className="bencho-progress-ticks-head">
        <span className="bencho-progress-ticks-figure">{shown}<i>%</i></span>
        <span
          className="bencho-progress-ticks-delta"
          data-show={cursor !== null && delta !== 0}
          data-up={delta > 0}
        >
          {delta > 0 ? '+' : ''}{delta}
        </span>
      </div>
      <div
        className="bencho-progress-ticks-row"
        ref={row}
        onPointerDown={(event) => {
          down.current = true;
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* scripted press */ }
          to(at(event.clientX));
        }}
        onPointerMove={track}
        onPointerUp={() => { down.current = false; to(null); }}
        onPointerCancel={() => { down.current = false; to(null); }}
        onPointerLeave={() => { if (!down.current) to(null); }}
      >
        {Array.from({ length: TICKS }, (_, index) => (
          <div
            key={index}
            className="bencho-progress-tick"
            data-on={index < filled}
            data-cursor={cursor !== null && index === cursor}
            style={{ height: `${52 + Math.round(Math.sin(index / 3.1) * 14) + (index < filled ? 26 : 0)}%` }}
          />
        ))}
      </div>
    </div>
  );
}
