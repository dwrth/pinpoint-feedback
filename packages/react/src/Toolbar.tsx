import {
  ANNOTATION_COLORS,
  DEFAULT_STROKE_WIDTH,
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

export const TOOLS: { tool: AnnotationTool; label: string; key: string; Icon: ComponentType<IconProps> }[] = [
  { tool: "select", label: "Select", key: "V", Icon: PointerIcon },
  { tool: "pin", label: "Pin", key: "P", Icon: PinIcon },
  { tool: "arrow", label: "Arrow", key: "A", Icon: ArrowIcon },
  { tool: "rectangle", label: "Rectangle", key: "R", Icon: SquareIcon },
  { tool: "freehand", label: "Draw", key: "D", Icon: PencilIcon },
  { tool: "text", label: "Text", key: "T", Icon: TypeIcon },
];

const STROKE_PRESETS = [
  { label: "S", name: "Thin", base: DEFAULT_STROKE_WIDTH / 2 },
  { label: "M", name: "Medium", base: DEFAULT_STROKE_WIDTH },
  { label: "L", name: "Thick", base: (DEFAULT_STROKE_WIDTH * 5) / 3 },
];

/** Stroke widths are in screenshot pixels, so presets scale with the capture's pixel ratio. */
export function strokeWidthsFor(scale: number) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return STROKE_PRESETS.map(({ label, name, base }) => ({
    label,
    name,
    width: Math.max(1, Math.round(base * factor)),
  }));
}

const COLOR_NAMES: Record<string, string> = {
  "#ef4444": "Red",
  "#f97316": "Orange",
  "#f59e0b": "Amber",
  "#eab308": "Yellow",
  "#22c55e": "Green",
  "#10b981": "Emerald",
  "#06b6d4": "Cyan",
  "#3b82f6": "Blue",
  "#6366f1": "Indigo",
  "#8b5cf6": "Violet",
  "#a855f7": "Purple",
  "#ec4899": "Pink",
  "#000000": "Black",
  "#111111": "Black",
  "#18181b": "Black",
  "#111827": "Black",
  "#ffffff": "White",
};

function colorName(color: string): string {
  return COLOR_NAMES[color.toLowerCase()] ?? color;
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
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
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
  const off = disabled || !editor || !state;
  const strokeWidths = strokeWidthsFor(scale);
  return (
    <div
      role="toolbar"
      aria-label="Annotation tools"
      className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-surface px-2 [scrollbar-width:none]"
    >
      <div role="group" aria-label="Tools" className="flex items-center gap-0.5">
        {TOOLS.map(({ tool, label, key, Icon }) => (
          <ToolButton
            key={tool}
            label={label}
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
      <div role="group" aria-label="Color" className="flex items-center gap-1 px-1">
        {ANNOTATION_COLORS.map((color) => {
          const selected = state?.color.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              aria-label={`Color ${colorName(color)}`}
              aria-pressed={selected}
              title={colorName(color)}
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
      <div role="group" aria-label="Stroke width" className="flex items-center gap-0.5">
        {strokeWidths.map(({ label, name, width }) => (
          <ToolButton
            key={label}
            label={`${name} stroke`}
            pressed={state?.strokeWidth === width}
            disabled={off}
            onClick={() => editor?.setStrokeWidth(width)}
            className="w-7 text-xs font-semibold"
          >
            {label}
          </ToolButton>
        ))}
      </div>
      <Divider />
      <ToolButton label="Undo" shortcut="Mod+Z" disabled={off || !state?.canUndo} onClick={() => editor?.undo()}>
        <UndoIcon />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Mod+Shift+Z" disabled={off || !state?.canRedo} onClick={() => editor?.redo()}>
        <RedoIcon />
      </ToolButton>
      <ToolButton label="Clear annotations" disabled={off || !state?.annotationCount} onClick={() => editor?.clear()}>
        <TrashIcon />
      </ToolButton>
      <div className="min-w-2 flex-1" />
      <div role="group" aria-label="Zoom" className="flex items-center gap-0.5">
        <ToolButton label="Zoom out" shortcut="-" disabled={off} onClick={() => editor?.zoomOut()}>
          <MinusIcon />
        </ToolButton>
        <button
          type="button"
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100%"
          disabled={off}
          onClick={() => editor?.setZoom(1)}
          className="h-8 min-w-12 shrink-0 rounded-md px-1 text-xs font-medium text-fg-muted tabular-nums transition-colors duration-150 hover:bg-muted hover:text-fg disabled:opacity-40"
        >
          {state ? `${Math.round(state.zoom * 100)}%` : "–"}
        </button>
        <ToolButton label="Zoom in" shortcut="+" disabled={off} onClick={() => editor?.zoomIn()}>
          <PlusIcon />
        </ToolButton>
        <ToolButton label="Fit to view" shortcut="0" disabled={off} onClick={() => editor?.fitToView()}>
          <FitIcon />
        </ToolButton>
      </div>
      <Divider />
      <ToolButton label="Reset screenshot" disabled={off} onClick={() => editor?.reset()}>
        <ResetIcon />
      </ToolButton>
      <button
        type="button"
        onClick={onRetake}
        disabled={disabled}
        title="Retake screenshot"
        className="ml-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-fg-muted transition-colors duration-150 hover:bg-muted hover:text-fg disabled:opacity-40"
      >
        <CameraIcon size={14} />
        Retake
      </button>
    </div>
  );
}
