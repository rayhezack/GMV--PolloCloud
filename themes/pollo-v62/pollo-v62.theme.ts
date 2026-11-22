// The pollo-v62 theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in pollo-v62.settings.json and the generated pollo-v62.settings.ts;
// change them with `astryx experimental theme editor set pollo-v62 ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {polloV62Settings} from './pollo-v62.settings';

export const polloV62Theme = defineTheme({
  extends: polloV62Settings,
  name: 'pollo-v62',
  tokens: {
    "--v62-accent": "#533afd",
    "--v62-accent-soft": "#f0edff",
    "--v62-accent-pale": "#e9e3ff",
    "--v62-ink": "#0d253d",
    "--v62-muted": "#53627a",
    "--v62-canvas": "#f5f6f8",
    "--v62-surface": "#fff",
    "--v62-selected": "#f0f1f4",
    "--v62-line": "#e3e8ee",
    "--v62-positive": "#12804a",
    "--v62-positive-soft": "#eaf6ee",
    "--v62-negative": "#d33a43",
    "--v62-negative-soft": "#fff0f0",
    "--v62-negative-bar": "#f3aab0",
    "--v62-benchmark": "#a6a6b2",
    "--v62-floating-shadow": "0 12px 40px rgb(13 37 61 / .12)",
    "--v62-radius": "16px",
    "--color-accent": "#533afd",
    "--color-background-body": "#f5f6f8",
    "--color-background-surface": "#ffffff",
    "--color-text-primary": "#0d253d",
    "--color-text-secondary": "#53627a",
    "--color-border": "#e3e8ee",
    "--color-focus-ring": "#533afd",
    "--v62-category-1": "#9d7bf5",
    "--v62-category-2": "#5b8def",
    "--v62-category-3": "#9ab8db",
    "--v62-category-4": "#f2c46d",
    "--v62-category-other": "#d9d9e0",
    "--text-heading-1-size": "1.5rem",
    "--text-heading-2-size": ".9375rem",
    "--text-heading-3-size": ".875rem",
    "--text-supporting-size": ".75rem",
    "--v62-space-page": "1.5rem"
},
});
