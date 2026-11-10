# 分析工作台图标

12 个图标：8 个功能图标及文件夹、邮件、下载、日历 4 个对照范例。展示页每行 4 个，手机 2 个，宽屏 6 个。

| 功能 | 图标 | 悬停动作 |
| --- | --- | --- |
| GMV 趋势 | chart-line | 折线重绘 |
| 付费类型 | credit-card | 银行卡展开 |
| 支付链路 | link | 链环相扣 |
| 创作积极性 | paintbrush | 画笔落笔 |
| 付费广告 | megaphone | 声波展开 |
| 诊断报告 | file-chart | 柱状数据增长 |
| 数据与口径 | database | 数据盘抬起 |
| 账号与权限 | shield-check | 盾牌轻抬 |

应用使用 24px，默认从蓝灰 `#61718a`、选中从品牌紫 `#533afd` 推导浅色：填充向白色提亮 84%，描边提亮 38%，保持轻透感。整行悬停和键盘焦点触发一次形变；移出后复位。遵循系统减少动态效果偏好。

`src/engine.js` 为 Kubai 原版引擎，未修改。`src/icons.js` 复用库内图标，通过 `src/bridge.js` 接入 React；生成文件不手动修改。

从仓库根目录重新生成应用运行文件：

```sh
node design-assets/workbench-icons/build.mjs
```

检查静止、悬停、过程帧、24/28px 和色板：

```sh
node design-assets/workbench-icons/scripts/check.mjs --out /tmp/pollo-workbench-icon-check
```

直接打开 `index.html` 可查看独立展示页。引擎、范例及展示工具遵循 [Kubai Icons License](LICENSE)；选用的库图标遵循 [MIT](LICENSE-ICONS)。版权声明保留于各来源文件。
