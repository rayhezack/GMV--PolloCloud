# Document Stack 文档弹出动画

这是 Pollo 项目已落地交互的独立快照，参考用户提供的视频；不是 Bencho 官方源码分发。只依赖 React 和局部 CSS，不接生产数据、诊断接口、Router 或阅读器。

## 一条命令接入

```sh
node install.mjs /absolute/path/to/project/src/components/DocumentStack
```

已有文件内容不同时中止，绝不覆盖。项目需已安装 React；CSS 随 TSX 自动导入。

```tsx
import { DocumentStack } from './components/DocumentStack/DocumentStack';
<DocumentStack
  title="日诊断"
  date="2026-11-08"
  documents={[
    { id: 'all', title: '大盘 · 日诊断' },
    { id: 'web', title: 'Web · 日诊断' },
  ]}
  emptyLabel="暂无报告"
  onOpen={id => openYourReader(id)}
/>
```

`documents` 只放真正完成、同一选定日期的结果；支持 0–3 份。尚未完成或失败的任务由业务层呈现。`onEmptyClick` 可选，打开任务详情；空数组时悬停不展开。`coverRef` 用于阅读器关闭后恢复焦点。`ariaLabel` 可为单份报告提供完整日期和名称。

## 预览

Node 22+，在本目录执行 `npm install`，然后 `npm run dev`。预览只含固定示例，可以切换 0/1/2/3 份，不读取业务数据库。也可在已有项目根目录执行 `npx vite reusable/document-stack --port 5207`，复用已安装依赖。

## 交互契约

- 收起高度 122px，封套 112px；展开两份 246px、三份 278px。容器真实增高，下方卡片顺势下移，不能用预留空白替代动画。
- 520ms 展开；纸张错峰 80/140ms，旋转 -5°/+6°/-9°。没有报告不弹空纸张。
- 悬停暂时展开；点击封套固定，再次点击解除固定。触摸使用点击；Tab 聚焦可展开，Enter 打开文档，Escape 收起。
- `prefers-reduced-motion` 关闭过渡，保留展开后的最终位置与可点击性。
- 样式命名空间 `bencho-document-*`，颜色通过 `--ui-ink`、`--ui-muted` 适配。无箭头、没有摘要色块，不改变宿主页面字体。

## 来源与维护

生产组件：`client/src/components/bencho/DocumentStack.tsx` / `.css`；业务适配：`client/src/components/dashboard/DailyReportStack.tsx`。本目录是可分发快照，修改生产组件后同步两个源文件，并重新核对 0–3 份、鼠标、键盘、触摸与减少动态效果。

引用视频和 GIF 保存在用户 Obsidian Bencho 原始资料目录，不包含在 GitHub 复用包中。没有将其标为官方 MIT 素材；组件为本项目实现。
