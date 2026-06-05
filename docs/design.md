# Opticlick Design System (ODS)

Opticlick Design System (ODS) is a modern, semantic styling system built on **Tailwind CSS v4** and **CSS custom properties**. It is designed to provide a cohesive visual style featuring the classic **Sky Blue Accent** colors, a **Slate Neutral** palette, and smooth transitions when toggling dark mode.

---

## 1. Typography

We load modern typefaces via Google Fonts in the sidepanel's [index.html](file:///Users/sudipmondal/mando/opticlick/src/entrypoints/sidepanel/index.html) to create a clear typography hierarchy:

*   **Display Font (`font-display`)**: **Plus Jakarta Sans**
    *   *Usage*: Brand logos, section headers, dialog titles, and main badges.
    *   *Rationale*: A geometric sans-serif that feels clean, premium, and tech-forward.
*   **Sans-Serif UI Font (`font-sans`)**: **Inter**
    *   *Usage*: Default UI text, buttons, input fields, dropdown selections, and normal descriptions.
    *   *Rationale*: Highly legible at small sizes with excellent spacing.
*   **Monospace Font (`font-mono`)**: **JetBrains Mono**
    *   *Usage*: Terminal logs, step counters, key codes, raw configurations, and codeblocks.
    *   *Rationale*: Designed for programmers with high readability in tabular and data-heavy layouts.

---

## 2. Color System (CSS Variables)

We define theme variables dynamically in [style.css](file:///Users/sudipmondal/mando/opticlick/src/entrypoints/sidepanel/style.css). Tailwind v4 utility classes map directly to these variables.

### Palette Specifications

| Token | Light Theme | Dark Theme | Purpose / Usage |
| :--- | :--- | :--- | :--- |
| `background` | `#ffffff` | `#020617` | Primary container backdrops (slate-950 dark) |
| `foreground` | `#0f172a` | `#f1f5f9` | Primary text and default icons |
| `card` | `#ffffff` | `#020617` | Cards, dropdown options, and list items |
| `popover` | `#ffffff` | `#0f172a` | Modals, slash-menu dropdowns, and overlays |
| `primary` | `#0284c7` | `#38bdf8` | Active states, primary CTAs, brand highlights (sky-600/400) |
| `secondary` | `#e2e8f0` | `#1e293b` | Secondary buttons, selection list hover bases (slate-200/800) |
| `muted` | `#f1f5f9` | `#0f172a` | Sidebar tabs, text inputs, header backgrounds (slate-100/900) |
| `accent` | `#f0f9ff` | `rgba(56, 189, 248, 0.15)` | Highlight pill backgrounds |
| `destructive` | `#ef4444` | `#f87171` | Warning labels, stop actions, clear keys |
| `border` | `#e2e8f0` | `#334155` | Default containers, divider borders (slate-200/700) |
| `input` | `#cbd5e1` | `#475569` | Hovered borders, active inputs |

### Provider Highlights

We use distinct brand accent colors for specific AI models and integrations:

*   **Gemini**: `--color-gemini` (`#0284c7` / `#38bdf8`) & `--color-gemini-bg`
*   **Claude**: `--color-anthropic` (`#d97706` / `#fbbf24`) & `--color-anthropic-bg`
*   **OpenAI**: `--color-openai` (`#16a34a` / `#4ade80`) & `--color-openai-bg`
*   **Ollama**: `--color-ollama` (`#059669` / `#34d399`) & `--color-ollama-bg`
*   **Custom**: `--color-custom` (`#7c3aed` / `#a78bfa`) & `--color-custom-bg`

---

## 3. Dark Mode Transitions

To provide a premium and fluid experience, ODS enforces a targeted CSS transition for theme switching. We avoid wildcards (`*`) to preserve standard width, height, and transform transitions.

The transition rules are defined in [style.css](file:///Users/sudipmondal/mando/opticlick/src/entrypoints/sidepanel/style.css):
```css
body,
header,
button,
input,
textarea,
pre,
code,
.bg-background,
.bg-card,
.bg-muted,
.bg-secondary,
.border-border,
.border-input,
.text-foreground,
.text-muted-foreground,
.text-primary {
  transition: background-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
              border-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
              color 200ms cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1),
              opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 4. Developer Guidelines

When building or updating UI features, future developers should follow these rules:

1.  **Do Not Hardcode Tailwind Slate or Sky Colors**:
    *   *Bad*: `bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800`
    *   *Good*: `bg-muted border border-border`
2.  **Use Glassmorphic Backdrops for Modals/Overlays**:
    *   Always use `bg-background/95 backdrop-blur-md` for full-screen overlays (such as past sessions, templates, and API keys) to give a modern depth effect.
3.  **Leverage Micro-Animations**:
    *   Use `transition-all duration-200 active:scale-95` on interactive icons and small buttons.
    *   Use `transition-all duration-200 active:scale-[0.97]` on large run/stop buttons.
4.  **Keep Typography Consistent**:
    *   Use `font-display` exclusively for titles and header texts.
    *   Use `font-mono` for console items, timestamps, metrics, and logs.
5.  **Utilize Provider-Specific Utility Classes**:
    *   Use classes like `bg-gemini-bg text-gemini` rather than styling each provider ad-hoc.
