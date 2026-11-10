import { defineLocale } from "./bundle";
import { enCapture } from "./capture";
import { enEditor } from "./editor";
import { enReport } from "./report";
import { enWidget } from "./widget";

export const en = defineLocale({
  locale: "en",
  dir: "ltr",
  widget: enWidget,
  editor: enEditor,
  capture: enCapture,
  report: enReport,
});
