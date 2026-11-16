import { ROUNDNESS, THEME, applyDarkModeFilter } from "@excalidraw/common";
import {
  getStickyNoteFillColor,
  getStickyNoteShadow,
  newStickyNoteElement,
} from "@excalidraw/element";

import type { FractionalIndex } from "@excalidraw/element/types";

import { exportScene } from "../scene/export";

const STICKY = {
  ...newStickyNoteElement({
    type: "stickynote",
    x: 10,
    y: 20,
    width: 250,
    height: 250,
    baseHeight: 250,
    backgroundColor: "#ffdf6b",
    roughness: 1,
    roundness: { type: ROUNDNESS.PROPORTIONAL_RADIUS },
  }),
  id: "sticky-1",
  seed: 4242,
  // fixed so the footer date label is stable
  created: Date.UTC(2024, 4, 3),
  index: "a0" as FractionalIndex,
};

const exportSvg = (theme: "light" | "dark" = THEME.LIGHT) =>
  exportScene({
    type: "svg",
    data: {
      elements: [STICKY],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    },
    config: { canvasBackgroundColor: false, theme },
  });

describe("sticky note SVG export", () => {
  it("draws a blurred shadow, the tone-shifted paper and a bottom shade", async () => {
    const svg = await exportSvg();

    const filter = svg.querySelector(`filter[id^="sticky-note-shadow-"]`);
    expect(filter).not.toBeNull();
    const blur = filter!.querySelector("feGaussianBlur");
    expect(Number(blur!.getAttribute("stdDeviation"))).toBeCloseTo(
      getStickyNoteShadow(STICKY).blur / 2,
    );

    const shadowPath = svg.querySelector(`path[filter="url(#${filter!.id})"]`);
    expect(shadowPath).not.toBeNull();

    const fill = getStickyNoteFillColor(STICKY);
    expect(fill).not.toBe(STICKY.backgroundColor);
    expect(svg.querySelector(`path[fill="${fill}"]`)).not.toBeNull();

    const gradient = svg.querySelector(
      `linearGradient[id^="sticky-note-shade-"]`,
    );
    expect(gradient).not.toBeNull();
    expect(
      svg.querySelector(`path[fill="url(#${gradient!.id})"]`),
    ).not.toBeNull();
  });

  it("applies the dark-mode filter on top of the tone shift", async () => {
    const svg = await exportSvg(THEME.DARK);
    const fill = applyDarkModeFilter(getStickyNoteFillColor(STICKY), true);
    expect(svg.querySelector(`path[fill="${fill}"]`)).not.toBeNull();
  });

  it("matches the snapshot", async () => {
    const svg = await exportSvg();
    const group = svg.querySelector(`path[filter]`)!.parentElement!;
    expect(group.outerHTML).toMatchSnapshot();
  });
});

describe("sticky note canvas export", () => {
  it("paints a blurred shadow and the tone-shifted paper", async () => {
    const canvas = await exportScene({
      type: "canvas",
      data: {
        elements: [STICKY],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      },
      config: { canvasBackgroundColor: false },
    });
    const events = (canvas.getContext("2d") as any).__getEvents() as {
      type: string;
      props: { value?: unknown };
    }[];

    const blurs = events
      .filter((event) => event.type === "shadowBlur")
      .map((event) => event.props.value as number);
    expect(blurs.some((value) => value > 0)).toBe(true);

    const fills = events
      .filter((event) => event.type === "fillStyle")
      .map((event) => String(event.props.value).toLowerCase());
    expect(fills).toContain(getStickyNoteFillColor(STICKY).toLowerCase());

    expect(events.some((event) => event.type === "createLinearGradient")).toBe(
      true,
    );
  });
});
