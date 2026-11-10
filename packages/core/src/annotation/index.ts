export {
  ANNOTATION_COLORS,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_MAX_ZOOM,
  ZOOM_STEP,
  pinRadiusFor,
  textSizeFor,
} from "./constants";
export {
  type ViewTransform,
  type Rect,
  type GeometryOptions,
  type ZoomLimits,
  type MeasureText,
  screenToImage,
  imageToScreen,
  normalizeRect,
  normalizeRectangle,
  simplifyPath,
  renumberPins,
  nextPinNumber,
  cloneAnnotation,
  cloneAnnotations,
  translateAnnotation,
  annotationBounds,
  hitTestAnnotation,
  hitTestAnnotation as hitTest,
  findAnnotationAt,
  computeFitZoom,
  fitView,
  resolveZoomLimits,
  clampZoom,
  zoomAround,
  clampPan,
} from "./geometry";
export { AnnotationHistory } from "./history";
export { type RenderAnnotationsOptions, renderAnnotations, defaultAnnotationRenderer } from "./render";
export { createAnnotationEditor } from "./editor";
