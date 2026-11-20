/**
 * KuszCanvas: runs the board shaders (`blackboardShader.ts`) on an offscreen
 * WebGL2 canvas and copies the result onto a 2D canvas.
 *
 * Two passes per region: the haze (mottling) at a quarter of the device
 * resolution into a texture, then the board at full resolution, sampling
 * it. One GL canvas per owning document (a popout window never draws a
 * canvas from another window). The last render is kept
 * (preserveDrawingBuffer), so a repaint without a view change only copies.
 */
import {
  BOARD_DETAIL_LAYERS,
  BOARD_FRAGMENT_SHADER,
  BOARD_HAZE_FRAGMENT_SHADER,
  BOARD_HAZE_LAYERS,
  BOARD_NOISE_SEED,
  BOARD_NOISE_SIZE,
  BOARD_SHADER_BASE,
  BOARD_SHADER_TINT,
  BOARD_VERTEX_SHADER,
  generateBoardNoise,
  getBoardHazeSize,
  getBoardLayerUniforms,
  getBoardRegionFrame,
  planBoardChunks,
} from "@excalidraw/element";

import type { BoardFrame, BoardLayer } from "@excalidraw/element";

export type BoardShaderView = Readonly<{
  scrollX: number;
  scrollY: number;
  zoom: number;
}>;

type LayerLocations = Readonly<{
  layer: BoardLayer;
  lattice: WebGLUniformLocation | null;
  matrix: WebGLUniformLocation | null;
  cell: WebGLUniformLocation | null;
}>;

type Pass = Readonly<{
  program: WebGLProgram;
  size: WebGLUniformLocation | null;
  layers: readonly LayerLocations[];
}>;

type BoardRenderer = {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly haze: Pass;
  readonly board: Pass;
  readonly hazeSize: WebGLUniformLocation | null;
  readonly hazeTexture: WebGLTexture;
  readonly hazeTarget: WebGLFramebuffer;
  /** largest chunk edge, device px */
  readonly maxChunk: number;
  hazeWidth: number;
  hazeHeight: number;
  /** what the canvas holds now */
  key: string | null;
  lost: boolean;
};

/** Upper bound on a chunk edge, device px, whatever the GPU allows. */
const MAX_CHUNK = 4096;
const NOISE_UNIT = 0;
const HAZE_UNIT = 1;

const renderers = new WeakMap<Document, BoardRenderer | null>();

const compile = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("KuszCanvas board shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createPass = (
  gl: WebGL2RenderingContext,
  fragmentSource: string,
  layers: readonly BoardLayer[],
): Pass | null => {
  const vertex = compile(gl, gl.VERTEX_SHADER, BOARD_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) {
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("KuszCanvas board shader:", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "uNoise"), NOISE_UNIT);
  return {
    program,
    size: gl.getUniformLocation(program, "uSize"),
    layers: layers.map((layer) => ({
      layer,
      lattice: gl.getUniformLocation(program, `${layer.uniform}Lattice`),
      matrix: gl.getUniformLocation(program, `${layer.uniform}Matrix`),
      cell: gl.getUniformLocation(program, `${layer.uniform}Cell`),
    })),
  };
};

const createTexture = (
  gl: WebGL2RenderingContext,
  unit: number,
  wrap: number,
): WebGLTexture | null => {
  const texture = gl.createTexture();
  if (!texture) {
    return null;
  }
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return texture;
};

const createRenderer = (doc: Document): BoardRenderer | null => {
  const canvas = doc.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    // the last render is copied again on repaints without a view change
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    return null;
  }
  const haze = createPass(gl, BOARD_HAZE_FRAGMENT_SHADER, BOARD_HAZE_LAYERS);
  const board = createPass(gl, BOARD_FRAGMENT_SHADER, BOARD_DETAIL_LAYERS);
  if (!haze || !board) {
    return null;
  }
  gl.useProgram(board.program);
  gl.uniform1i(gl.getUniformLocation(board.program, "uHaze"), HAZE_UNIT);
  gl.uniform3f(
    gl.getUniformLocation(board.program, "uBase"),
    BOARD_SHADER_BASE[0] / 255,
    BOARD_SHADER_BASE[1] / 255,
    BOARD_SHADER_BASE[2] / 255,
  );
  gl.uniform3f(
    gl.getUniformLocation(board.program, "uTint"),
    BOARD_SHADER_TINT[0],
    BOARD_SHADER_TINT[1],
    BOARD_SHADER_TINT[2],
  );

  const noise = createTexture(gl, NOISE_UNIT, gl.REPEAT);
  if (!noise) {
    return null;
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    BOARD_NOISE_SIZE,
    BOARD_NOISE_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    generateBoardNoise(BOARD_NOISE_SIZE, BOARD_NOISE_SEED),
  );
  const hazeTexture = createTexture(gl, HAZE_UNIT, gl.CLAMP_TO_EDGE);
  const hazeTarget = gl.createFramebuffer();
  if (!hazeTexture || !hazeTarget) {
    return null;
  }

  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number;
  const renderer: BoardRenderer = {
    canvas,
    gl,
    haze,
    board,
    hazeSize: gl.getUniformLocation(board.program, "uHazeSize"),
    hazeTexture,
    hazeTarget,
    maxChunk: Math.max(
      1,
      Math.min(MAX_CHUNK, viewport[0], viewport[1], renderbuffer),
    ),
    hazeWidth: 0,
    hazeHeight: 0,
    key: null,
    lost: false,
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    // allow a restore; the next paint builds a fresh renderer meanwhile
    event.preventDefault();
    renderer.lost = true;
  });
  return renderer;
};

const getRenderer = (doc: Document): BoardRenderer | null => {
  const existing = renderers.get(doc);
  if (existing && existing.lost) {
    renderers.delete(doc);
  } else if (renderers.has(doc)) {
    return existing ?? null;
  }
  const created = createRenderer(doc);
  renderers.set(doc, created);
  return created;
};

const setLayerUniforms = (
  gl: WebGL2RenderingContext,
  pass: Pass,
  frame: BoardFrame,
) => {
  for (const locations of pass.layers) {
    const uniforms = getBoardLayerUniforms(locations.layer, frame);
    gl.uniform4fv(locations.lattice, uniforms.lattice);
    gl.uniform4fv(locations.matrix, uniforms.matrix);
    gl.uniform4iv(locations.cell, uniforms.cell);
  }
};

const renderRegion = (
  renderer: BoardRenderer,
  frame: BoardFrame,
  width: number,
  height: number,
) => {
  const { gl, canvas } = renderer;
  const hazeSize = getBoardHazeSize(width, height);

  // pass 1: the haze, into its texture
  gl.activeTexture(gl.TEXTURE0 + HAZE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, renderer.hazeTexture);
  if (
    renderer.hazeWidth !== hazeSize.width ||
    renderer.hazeHeight !== hazeSize.height
  ) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      hazeSize.width,
      hazeSize.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    renderer.hazeWidth = hazeSize.width;
    renderer.hazeHeight = hazeSize.height;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.hazeTarget);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    renderer.hazeTexture,
    0,
  );
  gl.viewport(0, 0, hazeSize.width, hazeSize.height);
  gl.useProgram(renderer.haze.program);
  gl.uniform2f(renderer.haze.size, hazeSize.width, hazeSize.height);
  setLayerUniforms(gl, renderer.haze, frame);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // pass 2: the board, onto the canvas
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  gl.useProgram(renderer.board.program);
  gl.uniform2f(renderer.board.size, width, height);
  gl.uniform2f(renderer.hazeSize, hazeSize.width, hazeSize.height);
  setLayerUniforms(gl, renderer.board, frame);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};

/** Device px per CSS px of a context scaled by `bootstrapCanvas`. */
const getPixelRatio = (
  context: CanvasRenderingContext2D,
  width: number,
): number => {
  const ratio =
    typeof context.getTransform === "function"
      ? context.getTransform().a
      : context.canvas.width / width;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
};

/**
 * Paints the board over `width` × `height` CSS px of `context` (scaled to
 * CSS px, no rotation). False when WebGL2 is unavailable, leaving the
 * context untouched.
 */
export const paintBoardShader = (
  context: CanvasRenderingContext2D,
  view: BoardShaderView,
  width: number,
  height: number,
): boolean => {
  if (!context || !context.canvas) {
    throw new Error("paintBoardShader(): context is required");
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("paintBoardShader(): size must be finite");
  }
  if (!view || !Number.isFinite(view.zoom) || view.zoom <= 0) {
    throw new Error("paintBoardShader(): view zoom must be > 0");
  }
  // UNTOUCHABLE: OffscreenCanvas and node-canvas have no owner document and
  // jsdom has no WebGL; those keep the flat board
  const doc = (context.canvas as HTMLCanvasElement).ownerDocument;
  if (!doc || typeof doc.createElement !== "function") {
    return false;
  }
  const renderer = getRenderer(doc);
  if (!renderer) {
    return false;
  }
  const pixelRatio = getPixelRatio(context, width);
  const deviceWidth = Math.max(0, Math.round(width * pixelRatio));
  const deviceHeight = Math.max(0, Math.round(height * pixelRatio));
  const chunks = planBoardChunks(deviceWidth, deviceHeight, renderer.maxChunk);
  for (const chunk of chunks) {
    const key = [
      view.scrollX,
      view.scrollY,
      view.zoom,
      pixelRatio,
      chunk.x,
      chunk.y,
      chunk.width,
      chunk.height,
    ].join(",");
    if (renderer.key !== key) {
      renderRegion(
        renderer,
        getBoardRegionFrame(view, pixelRatio, chunk.x, chunk.y),
        chunk.width,
        chunk.height,
      );
      renderer.key = key;
    }
    context.drawImage(
      renderer.canvas,
      0,
      0,
      chunk.width,
      chunk.height,
      chunk.x / pixelRatio,
      chunk.y / pixelRatio,
      chunk.width / pixelRatio,
      chunk.height / pixelRatio,
    );
  }
  return !renderer.lost;
};
