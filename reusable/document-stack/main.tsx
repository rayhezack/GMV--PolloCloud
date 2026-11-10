import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentStack } from './DocumentStack';
import './demo.css';
function Demo() {
  const [count, setCount] = useState(2);
  const [selected, setSelected] = useState('');
  const coverRef = useRef<HTMLButtonElement>(null);
  const documents = ['大盘', 'Web', 'App'].slice(0, count).map(id => ({id, title:`${id} · 日诊断`}));
  return <main>
    <header><h1>Document Stack</h1><p>悬停展开 · 点击固定 · 选择文档</p></header>
    <nav aria-label="预览报告数量">{[0,1,2,3].map(n => <button key={n} aria-pressed={n===count} onClick={() => setCount(n)}>{n} 份</button>)}</nav>
    <section className="rail">
      <article className="bento"><h2>每日动态</h2><div className="sample"><span>Web · 大盘 GMV</span><span>示例数据</span></div>
        <DocumentStack title="日诊断" date="2026-11-08" documents={documents} onOpen={setSelected} emptyLabel="暂无报告" coverRef={coverRef} />
      </article>
      <article className="bento sibling"><h2>更新通知</h2><p>文档展开时，此卡随布局向下移动。</p></article>
    </section>
    {selected && <dialog open onKeyDown={e => {if(e.key==='Escape'){setSelected('');coverRef.current?.focus();}}} aria-label={`${selected}示例报告`}>
      <h2>{selected} · 日诊断</h2><p>这里接入业务自己的文档阅读器。本示例不访问生产接口。</p>
      <button autoFocus onClick={() => {setSelected('');coverRef.current?.focus();}}>关闭</button>
    </dialog>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo />);
