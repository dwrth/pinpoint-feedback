import {
  ANNOTATION_COLORS,
  DEFAULT_STROKE_WIDTH,
  formatPercent,
  type AnnotationEditor,
  type AnnotationEditorState,
  type AnnotationTool,
} from "@pinpoint-feedback/core";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowIcon,
  CameraIcon,
  FitIcon,
  MinusIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  PointerIcon,
  RedoIcon,
  ResetIcon,
  SquareIcon,
  TrashIcon,
  TypeIcon,
  UndoIcon,
  type IconProps,
} from "./icons";
import { useI18n, type WidgetTranslate } from "./i18n";

export const TOOLS: { tool: AnnotationTool; key: string; Icon: ComponentType<IconProps> }[] = [
  { tool: "select", key: "V", Icon: PointerIcon },
  { tool: "pin", key: "P", Icon: PinIcon },
  { tool: "arrow", key: "A", Icon: ArrowIcon },
  { tool: "rectangle", key: "R", Icon: SquareIcon },
  { tool: "freehand", key: "D", Icon: PencilIcon },
  { tool: "text", key: "T", Icon: TypeIcon },
];

type StrokePreset = "thin" | "medium" | "thick";

const STROKE_PRESETS: { id: StrokePreset; base: number }[] = [
  { id: "thin", base: DEFAULT_STROKE_WIDTH / 2 },
  { id: "medium", base: DEFAULT_STROKE_WIDTH },
  { id: "thick", base: (DEFAULT_STROKE_WIDTH * 5) / 3 },
];

/** Stroke widths are in screenshot pixels, so presets scale with the capture's pixel ratio. */
export function strokeWidthsFor(scale: number) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return STROKE_PRESETS.map(({ id, base }) => ({ id, width: Math.max(1, Math.round(base * factor)) }));
}

type ColorName =
  | "red"
  | "orange"
  | "amber"
  | "yellow"
  | "green"
  | "emerald"
  | "cyan"
  | "blue"
  | "indigo"
  | "violet"
  | "purple"
  | "pink"
  | "black"
  | "white";

const COLOR_NAMES: Record<string, ColorName> = {
  "#ef4444": "red",
  "#f97316": "orange",
  "#f59e0b": "amber",
  "#eab308": "yellow",
  "#22c55e": "green",
  "#10b981": "emerald",
  "#06b6d4": "cyan",
  "#3b82f6": "blue",
  "#6366f1": "indigo",
  "#8b5cf6": "violet",
  "#a855f7": "purple",
  "#ec4899": "pink",
  "#000000": "black",
  "#111111": "black",
  "#18181b": "black",
  "#111827": "black",
  "#ffffff": "white",
};

function colorName(t: WidgetTranslate, color: string): string {
  const name = COLOR_NAMES[color.toLowerCase()];
  return name ? t(`color.${name}`) : color;
}

const btn =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg disabled:pointer-events-none disabled:opacity-40";

function ToolButton({
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
  children,
  className = "",
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? t("common.withShortcut", { label, shortcut }) : label}
      disabled={disabled}
      onClick={onClick}
      className={`${btn} ${pressed ? "bg-accent/12 text-accent hover:bg-accent/15 hover:text-accent" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-line" />;
}

export interface ToolbarProps {
  editor: AnnotationEditor | null;
  state: AnnotationEditorState | null;
  /** Screenshot pixels per CSS pixel. */
  scale: number;
  onRetake: () => void;
  disabled?: boolean;
}

export function Toolbar({ editor, state, scale, onRetake, disabled }: ToolbarProps) {
  const { t, locale } = useI18n();
  const off = disabled || !editor || !state;
  const strokeWidths = strokeWidthsFor(scale);
  return (
    <div
      role="toolbar"
      aria-label={t("toolbar.label")}
      className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 [scrollbar-width:none]"
    >
      <div role="group" aria-label={t("toolbar.tools")} className="flex items-center gap-0.5">
        {TOOLS.map(({ tool, key, Icon }) => (
          <ToolButton
            key={tool}
            label={t(`tool.${tool}`)}
            shortcut={key}
            pressed={state?.tool === tool}
            disabled={off}
            onClick={() => editor?.setTool(tool)}
          >
            <Icon />
          </ToolButton>
        ))}
      </div>
      <Divider />
      <div role="group" aria-label={t("toolbar.color")} className="flex items-center gap-1 px-1">
        {ANNOTATION_COLORS.map((color) => {
          const selected = state?.color.toLowerCase() === color.toLowerCase();
          const name = colorName(t, color);
          return (
            <button
              key={color}
              type="button"
              aria-label={t("toolbar.colorOption", { color: name })}
              aria-pressed={selected}
              title={name}
              disabled={off}
              onClick={() => editor?.setColor(color)}
              className={`grid size-6 shrink-0 place-items-center rounded-full transition-transform duration-150 hover:scale-110 disabled:opacity-40 ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
            >
              <span
                aria-hidden="true"
                className="size-4 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
                style={{ backgroundColor: color }}
              />
            </button>
          );
        })}
      </div>
      <Divider />
      <div role="group" aria-label={t("toolbar.strokeWidth")} className="flex items-center gap-0.5">
        {strokeWidths.map(({ id, width }) => (
          <ToolButton
            key={id}
            label={t(`stroke.${id}`)}
            pressed={state?.strokeWidth === width}
            disabled={off}
            onClick={() => editor?.setStrokeWidth(width)}
            className="min-w-7 px-1 text-xs font-semibold"
          >
            {t(`stroke.${id}Short`)}
          </ToolButton>
        ))}
      </div>
      <Divider />
      <ToolButton label={t("toolbar.undo")} shortcut="Mod+Z" disabled={off || !state?.canUndo} onClick={() => editor?.undo()}>
        <UndoIcon className="rtl:-scale-x-100" />
      </ToolButton>
      <ToolButton label={t("toolbar.redo")} shortcut="Mod+Shift+Z" disabled={off || !state?.canRedo} onClick={() => editor?.redo()}>
        <RedoIcon className="rtl:-scale-x-100" />
      </ToolButton>
      <ToolButton label={t("toolbar.clear")} disabled={off || !state?.annotationCount} onClick={() => editor?.clear()}>
        <TrashIcon />
      </ToolButton>
      <div className="min-w-2 flex-1" />
      <div role="group" aria-label={t("toolbar.zoom")} className="flex items-center gap-0.5">
        <ToolButton label={t("toolbar.zoomOut")} shortcut="-" disabled={off} onClick={() => editor?.zoomOut()}>
          <MinusIcon />
        </ToolButton>
        <button
          type="button"
          aria-label={t("toolbar.zoomReset", { percent: formatPercent(locale, 1) })}
          title={t("toolbar.zoomReset", { percent: formatPercent(locale, 1) })}
          disabled={off}
          onClick={() => editor?.setZoom(1)}
          className="h-8 min-w-12 shrink-0 rounded-md px-1 text-xs font-medium text-fg-muted tabular-nums transition-colors duration-150 hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          {state ? formatPercent(locale, state.zoom) : "–"}
        </button>
        <ToolButton label={t("toolbar.zoomIn")} shortcut="+" disabled={off} onClick={() => editor?.zoomIn()}>
          <PlusIcon />
        </ToolButton>
        <ToolButton label={t("toolbar.fit")} shortcut="0" disabled={off} onClick={() => editor?.fitToView()}>
          <FitIcon />
        </ToolButton>
      </div>
      <Divider />
      <ToolButton label={t("toolbar.resetScreenshot")} disabled={off} onClick={() => editor?.reset()}>
        <ResetIcon />
      </ToolButton>
      <button
        type="button"
        onClick={onRetake}
        disabled={disabled}
        title={t("toolbar.retakeTooltip")}
        className="ms-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg disabled:opacity-40"
      >
        <CameraIcon size={14} />
        {t("toolbar.retake")}
      </button>
    </div>
  );
}
