/**
 * KuszCanvas: frames styled like rectangles.
 *
 * New regular frames carry `customData.frameStyle = "shape"` and draw
 * through the rough generator exactly like a rectangle (stroke, fill,
 * sloppiness, edges). Frames without the flag ("legacy" frames) draw
 * through the same generator using their stored roughness and stroke width
 * but keep the host frame palette for their outline and paint no fill.
 * Marker frames and magic frames are never stylable and keep their own
 * renderers.
 *
 * Everything here is pure; the renderers and the App only call into it.
 */
import {
  FRAME_STYLE,
  ROUNDNESS,
  getStrokeWidthByKey,
  isTransparent,
} from "@excalidraw/common";

import type { AppState } from "@excalidraw/excalidraw/types";

import type { Drawable } from "roughjs/bin/core";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  ExcalidrawFrameLikeElement,
} from "./types";

/**
 * Value of `customData.frameStyle` on frames drawn like rectangles.
 * Contract with KuszCanvas-Obsidian `src/utils/dynamicStyling.ts`
 * (`needsDynamicFrameColor`), which skips recolouring frames carrying this
 * literal: change both together.
 */
export const FRAME_SHAPE_STYLE = "shape";

export type FrameShapeStyle = Pick<
  ExcalidrawElement,
  | "strokeColor"
  | "backgroundColor"
  | "fillStyle"
  | "strokeWidth"
  | "strokeStyle"
  | "roughness"
  | "roundness"
>;

const FRAME_SHAPE_STYLE_KEYS: readonly (keyof FrameShapeStyle)[] = [
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "roundness",
];

/** Properties whose change through the styles panel converts a legacy frame. */
const FRAME_STYLE_CHANGE_KEYS: readonly (keyof ExcalidrawElement)[] = [
  ...FRAME_SHAPE_STYLE_KEYS,
  "opacity",
];

export type FrameRenderPass = "full" | "fill" | "stroke";

type HostFrameColor = { stroke?: string } | null | undefined;

/** A regular frame: not a marker frame, not a magic frame. */
export const isStylableFrame = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawFrameElement =>
  !!element && element.type === "frame" && element.frameRole !== "marker";

/** A regular frame that has opted into rectangle styling. */
// deliberately not a type guard: `false` must not narrow a frame to `never`
export const isShapeStyledFrame = (
  element: ExcalidrawElement | null | undefined,
): boolean =>
  isStylableFrame(element) &&
  element.customData?.frameStyle === FRAME_SHAPE_STYLE;

/** The frame tool draws stylable frames unless it is set to marker frames. */
export const isStylableFrameTool = (
  toolType: string,
  frameRole: ExcalidrawFrameLikeElement["frameRole"] | null | undefined,
) => toolType === "frame" && frameRole !== "marker";

const LEGACY_FRAME_STYLE: FrameShapeStyle = {
  strokeColor: FRAME_STYLE.strokeColor,
  backgroundColor: FRAME_STYLE.backgroundColor,
  fillStyle: FRAME_STYLE.fillStyle,
  strokeWidth: FRAME_STYLE.strokeWidth,
  strokeStyle: FRAME_STYLE.strokeStyle,
  roughness: FRAME_STYLE.roughness,
  roundness: FRAME_STYLE.roundness,
};

/**
 * The current-item styles a new rectangle would take, used for new frames
 * (frame tool and "wrap selection in frame").
 */
export const getCurrentItemFrameShapeStyle = (
  appState: Pick<
    AppState,
    | "currentItemStrokeColor"
    | "currentItemBackgroundColor"
    | "currentItemFillStyle"
    | "currentItemStrokeWidthKey"
    | "currentItemStrokeWidth"
    | "currentItemStrokeStyle"
    | "currentItemRoughness"
    | "currentItemRoundness"
  >,
): FrameShapeStyle => {
  if (!appState) {
    throw new Error("getCurrentItemFrameShapeStyle(): appState is required");
  }
  return {
    strokeColor: appState.currentItemStrokeColor,
    backgroundColor: appState.currentItemBackgroundColor,
    fillStyle: appState.currentItemFillStyle,
    strokeWidth: getStrokeWidthByKey(
      "rectangle",
      appState.currentItemStrokeWidthKey,
      appState.currentItemStrokeWidth,
    ),
    strokeStyle: appState.currentItemStrokeStyle,
    roughness: appState.currentItemRoughness,
    // frames use the rectangle's adaptive radius (see `isUsingAdaptiveRadius`)
    roundness:
      appState.currentItemRoundness === "round"
        ? { type: ROUNDNESS.ADAPTIVE_RADIUS }
        : null,
  };
};

/**
 * Constructor styles for a frame created with the frame tool. Regular
 * frames take the current-item styles and the shape flag; marker frames and
 * magic frames keep the legacy frame style and the host palette.
 */
export const getFrameCreationStyle = ({
  type,
  frameRole,
  currentItemStyle,
  hostFrameColor,
}: {
  type: "frame" | "magicframe";
  frameRole: ExcalidrawFrameLikeElement["frameRole"] | null | undefined;
  currentItemStyle: FrameShapeStyle;
  hostFrameColor: Record<string, string> | null | undefined;
}): FrameShapeStyle & { customData?: Record<string, unknown> } => {
  if (type !== "frame" && type !== "magicframe") {
    throw new Error(`getFrameCreationStyle(): invalid frame type "${type}"`);
  }
  if (type === "frame" && frameRole !== "marker") {
    for (const key of FRAME_SHAPE_STYLE_KEYS) {
      // roundness is legitimately null (sharp edges)
      if (currentItemStyle?.[key] === undefined) {
        throw new Error(
          `getFrameCreationStyle(): current item style is missing "${key}"`,
        );
      }
    }
    const style = {} as Record<keyof FrameShapeStyle, unknown>;
    for (const key of FRAME_SHAPE_STYLE_KEYS) {
      style[key] = currentItemStyle[key];
    }
    return {
      ...(style as FrameShapeStyle),
      customData: { frameStyle: FRAME_SHAPE_STYLE },
    };
  }
  return {
    ...LEGACY_FRAME_STYLE,
    ...(hostFrameColor ? { customData: { frameColor: hostFrameColor } } : {}),
  };
};

/**
 * The rectangle style a stylable frame is drawn with. Legacy frames use the
 * host palette for the outline (`customData.frameColor` → host
 * `frameColor` → `#bbb`), no fill and the old 8px rounded corners unless they
 * store a roundness of their own.
 */
export const resolveFrameRenderStyle = (
  frame: ExcalidrawElement,
  hostFrameColor: HostFrameColor,
): FrameShapeStyle => {
  if (!isStylableFrame(frame)) {
    throw new Error(
      `resolveFrameRenderStyle(): element ${frame?.id} is not a stylable frame`,
    );
  }
  if (isShapeStyledFrame(frame)) {
    return {
      strokeColor: frame.strokeColor,
      backgroundColor: frame.backgroundColor,
      fillStyle: frame.fillStyle,
      strokeWidth: frame.strokeWidth,
      strokeStyle: frame.strokeStyle,
      roughness: frame.roughness,
      roundness: frame.roundness,
    };
  }
  return {
    strokeColor:
      frame.customData?.frameColor?.stroke ??
      hostFrameColor?.stroke ??
      FRAME_STYLE.strokeColor,
    backgroundColor: "transparent",
    fillStyle: frame.fillStyle,
    strokeWidth: frame.strokeWidth,
    strokeStyle: frame.strokeStyle,
    roughness: frame.roughness,
    roundness: frame.roundness ?? {
      type: ROUNDNESS.ADAPTIVE_RADIUS,
      value: FRAME_STYLE.radius,
    },
  };
};

/**
 * Called after a styles-panel action produced `next` from `prev`: a legacy
 * frame whose style changed opts into rectangle styling. Returns `next`
 * unchanged in every other case.
 */
export const markFrameStyleChange = <T extends ExcalidrawElement>(
  prev: ExcalidrawElement,
  next: T,
): T => {
  if (
    prev === next ||
    !isStylableFrame(next) ||
    isShapeStyledFrame(next) ||
    !FRAME_STYLE_CHANGE_KEYS.some(
      (key) => JSON.stringify(prev[key]) !== JSON.stringify(next[key]),
    )
  ) {
    return next;
  }
  return {
    ...next,
    customData: { ...next.customData, frameStyle: FRAME_SHAPE_STYLE },
  };
};

/**
 * The part of a frame's cached rough drawable to paint in a render pass,
 * optionally with another stroke colour (legacy host palette). Never
 * mutates the cached drawable.
 */
export const getFrameDrawableForPass = (
  drawable: Drawable,
  pass: FrameRenderPass,
  strokeOverride: string | null,
): Drawable => {
  if (pass !== "full" && pass !== "fill" && pass !== "stroke") {
    throw new Error(`getFrameDrawableForPass(): invalid pass "${pass}"`);
  }
  if (pass === "full" && strokeOverride === null) {
    return drawable;
  }
  return {
    ...drawable,
    options: strokeOverride
      ? { ...drawable.options, stroke: strokeOverride }
      : drawable.options,
    sets:
      pass === "full"
        ? drawable.sets
        : drawable.sets.filter((set) =>
            pass === "stroke" ? set.type === "path" : set.type !== "path",
          ),
  };
};

/**
 * Frame children sit just below their frame in z-order, so a frame's fill
 * must be painted before its lowest child or it would cover them. Returns,
 * keyed by the id of the element to paint before, the filled shape frames
 * whose fill pass belongs there. Frames listed here must then be drawn with
 * the "stroke" pass; a frame with no child below it in `elements` is not
 * listed and paints in full at its own z-index.
 */
export const getFrameFillAnchors = <T extends ExcalidrawElement>(
  elements: readonly T[],
): Map<string, (T & ExcalidrawFrameElement)[]> => {
  const filledFrames = new Map<string, T & ExcalidrawFrameElement>();
  for (const element of elements) {
    if (
      isStylableFrame(element) &&
      isShapeStyledFrame(element) &&
      !isTransparent(element.backgroundColor)
    ) {
      filledFrames.set(element.id, element);
    }
  }
  const anchors = new Map<string, (T & ExcalidrawFrameElement)[]>();
  if (!filledFrames.size) {
    return anchors;
  }
  const anchored = new Set<string>();
  for (const element of elements) {
    const frame =
      filledFrames.get(element.id) ??
      (element.frameId ? filledFrames.get(element.frameId) : undefined);
    if (!frame || anchored.has(frame.id)) {
      continue;
    }
    anchored.add(frame.id);
    if (element.id === frame.id) {
      // no child below the frame: nothing to split
      continue;
    }
    const list = anchors.get(element.id) ?? [];
    list.push(frame);
    anchors.set(element.id, list);
  }
  return anchors;
};
