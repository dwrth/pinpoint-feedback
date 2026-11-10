export interface RecordedCall {
  name: string;
  args: unknown[];
}

export interface RecordingContext {
  ctx: CanvasRenderingContext2D;
  calls: RecordedCall[];
  props: Record<string, unknown>;
  named(name: string): RecordedCall[];
}

/** Fake Canvas2D that records every method call and property assignment. */
export function createRecordingContext(canvas?: HTMLCanvasElement): RecordingContext {
  const calls: RecordedCall[] = [];
  const props: Record<string, unknown> = { font: "10px sans-serif", canvas };
  const target = {};
  const ctx = new Proxy(target, {
    get(_t, key) {
      if (typeof key !== "string") return undefined;
      if (key in props) return props[key];
      if (key === "measureText") {
        return (text: string) => {
          calls.push({ name: "measureText", args: [text] });
          const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(props.font))?.[1] ?? 10);
          return { width: text.length * size * 0.5 };
        };
      }
      return (...args: unknown[]) => {
        calls.push({ name: key, args });
      };
    },
    set(_t, key, value) {
      if (typeof key !== "string") return false;
      props[key] = value;
      calls.push({ name: `set:${key}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, props, named: (name) => calls.filter((c) => c.name === name) };
}
