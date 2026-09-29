/* Copyright 2021 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  PageViewport,
  RenderingCancelledException,
} from "../../src/display/display_utils.js";
import { PDFPageView } from "../../web/pdf_page_view.js";
import { PDFPageViewBuffer } from "../../web/pdf_viewer.js";
import { RenderingStates } from "../../web/renderable_view.js";

describe("PDFViewer", function () {
  describe("PDFPageViewBuffer", function () {
    function createViewsMap(startId, endId) {
      const map = new Map();

      for (let id = startId; id <= endId; id++) {
        map.set(id, {
          id,
          destroy: () => {},
        });
      }
      return map;
    }

    it("handles `push` correctly", function () {
      const buffer = new PDFPageViewBuffer(3);

      const viewsMap = createViewsMap(1, 5),
        iterator = viewsMap.values();

      for (let i = 0; i < 3; i++) {
        const view = iterator.next().value;
        buffer.push(view);
      }
      // Ensure that the correct views are inserted.
      expect([...buffer]).toEqual([
        viewsMap.get(1),
        viewsMap.get(2),
        viewsMap.get(3),
      ]);

      for (let i = 3; i < 5; i++) {
        const view = iterator.next().value;
        buffer.push(view);
      }
      // Ensure that the correct views are evicted.
      expect([...buffer]).toEqual([
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
      ]);
    });

    it("handles `resize` correctly", function () {
      const buffer = new PDFPageViewBuffer(5);

      const viewsMap = createViewsMap(1, 5),
        iterator = viewsMap.values();

      for (let i = 0; i < 5; i++) {
        const view = iterator.next().value;
        buffer.push(view);
      }
      // Ensure that keeping the size constant won't evict any views.
      buffer.resize(5);

      expect([...buffer]).toEqual([
        viewsMap.get(1),
        viewsMap.get(2),
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
      ]);

      // Ensure that increasing the size won't evict any views.
      buffer.resize(10);

      expect([...buffer]).toEqual([
        viewsMap.get(1),
        viewsMap.get(2),
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
      ]);

      // Ensure that decreasing the size will evict the correct views.
      buffer.resize(3);

      expect([...buffer]).toEqual([
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
      ]);
    });

    it("handles `resize` correctly, with `idsToKeep` provided", function () {
      const buffer = new PDFPageViewBuffer(5);

      const viewsMap = createViewsMap(1, 5),
        iterator = viewsMap.values();

      for (let i = 0; i < 5; i++) {
        const view = iterator.next().value;
        buffer.push(view);
      }
      // Ensure that keeping the size constant won't evict any views,
      // while re-ordering them correctly.
      buffer.resize(5, new Set([1, 2]));

      expect([...buffer]).toEqual([
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
        viewsMap.get(1),
        viewsMap.get(2),
      ]);

      // Ensure that increasing the size won't evict any views,
      // while re-ordering them correctly.
      buffer.resize(10, new Set([3, 4, 5]));

      expect([...buffer]).toEqual([
        viewsMap.get(1),
        viewsMap.get(2),
        viewsMap.get(3),
        viewsMap.get(4),
        viewsMap.get(5),
      ]);

      // Ensure that decreasing the size will evict the correct views,
      // while re-ordering the remaining ones correctly.
      buffer.resize(3, new Set([1, 2, 5]));

      expect([...buffer]).toEqual([
        viewsMap.get(1),
        viewsMap.get(2),
        viewsMap.get(5),
      ]);
    });

    it("handles `has` correctly", function () {
      const buffer = new PDFPageViewBuffer(3);

      const viewsMap = createViewsMap(1, 2),
        iterator = viewsMap.values();

      for (let i = 0; i < 1; i++) {
        const view = iterator.next().value;
        buffer.push(view);
      }
      expect(buffer.has(viewsMap.get(1))).toEqual(true);
      expect(buffer.has(viewsMap.get(2))).toEqual(false);
    });
  });
});

describe("PDFPageView text coloring", function () {
  let view, tasks, viewport;
  const regions = [{ rect: [20, 40, 60, 50], color: "#245e91" }];

  beforeEach(async function () {
    if (typeof document === "undefined") {
      pending("Requires a DOM");
    }
    viewport = new PageViewport({
      viewBox: [0, 0, 200, 160],
      scale: 1,
      rotation: 0,
      userUnit: 1,
    });
    tasks = [];
    view = new PDFPageView({
      id: 1,
      defaultViewport: viewport,
      l10n: {},
      eventBus: { dispatch() {} },
      maxCanvasPixels: 1000000,
      maxCanvasDim: 32767,
      capCanvasAreaFactor: -1,
      textLayerMode: 0,
      annotationMode: 0,
      layerProperties: { annotationEditorUIManager: null },
    });
    view.pdfPage = {
      getStructTree: async () => null,
      render(context) {
        const { promise, resolve, reject } = Promise.withResolvers();
        const task = {
          context,
          promise,
          resolve,
          reject,
          coloredTextRegions: context.textColorRegions || [],
          cancel: jasmine.createSpy("cancel").and.callFake(() => {
            const error = new RenderingCancelledException("cancelled", 0);
            task.onError?.(error);
            reject(error);
          }),
        };
        tasks.push(task);
        return task;
      },
    };
    // Exercise draw's real publication path, with controlled canvas completion.
    spyOn(view, "_drawCanvas").and.callFake(async (context, cancel, finish) => {
      view._ensureCanvasWrapper().prepend(view.canvas);
      view.renderingState = RenderingStates.FINISHED;
      finish(
        {
          separateAnnots: false,
          coloredTextRegions: context.textColorRegions || [],
        },
        null
      );
    });
    await view.draw();
    document.body.append(view.div);
  });

  afterEach(function () {
    delete window.getPageTextColorRegions;
    view?.reset();
    view?.div.remove();
  });

  async function complete(task) {
    task.resolve();
    await task.promise;
    await Promise.resolve();
  }

  it("changes only the canvas after success, preserving selection, focus and layers", async function () {
    const input = document.createElement("textarea");
    input.value = "annotation";
    view.div.append(input);
    input.focus();
    input.setSelectionRange(2, 5);
    const text = document.createElement("span");
    text.textContent = "selectable text";
    view.div.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
    expect(document.getSelection().toString()).toBe("selectable text");
    // Page selection can reset form selection in browsers such as Chrome.
    const inputSelection = [input.selectionStart, input.selectionEnd];
    const previous = view.canvas;
    const tree = document.createElement("span");
    tree.setAttribute("role", "heading");
    previous.append(tree);
    view.detailView = { reset: jasmine.createSpy("detail reset") };
    view.setTextColorRegions(regions);
    expect(view.canvas).toBe(previous);
    expect(view.coloredTextRegions).toEqual([]);
    expect(view.detailView.reset).not.toHaveBeenCalled();
    await complete(tasks[0]);
    expect(view.canvas).not.toBe(previous);
    expect(tree.parentNode).toBe(view.canvas);
    expect(tree.isConnected).toBeTrue();
    expect(previous.width).toBe(0);
    expect(view.coloredTextRegions).toEqual(regions);
    expect(view.detailView.reset).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual(inputSelection);
    expect(document.getSelection().toString()).toBe("selectable text");
    expect(view.thumbnailCanvas).toBeNull();
  });

  it("retains the visible canvas and fallback on failure", async function () {
    spyOn(console, "error");
    const previous = view.canvas;
    view.setTextColorRegions(regions);
    tasks[0].reject(new Error("render failed"));
    await tasks[0].promise.catch(() => {});
    expect(view.canvas).toBe(previous);
    expect(previous.isConnected).toBeTrue();
    expect(previous.width).toBeGreaterThan(0);
    expect(tasks[0].context.canvas.width).toBe(0);
    expect(view.coloredTextRegions).toEqual([]);
  });

  it("keeps fallback for unpainted regions without retrying the same request", async function () {
    view.setTextColorRegions(regions);
    tasks[0].coloredTextRegions = [];
    await complete(tasks[0]);
    expect(view.coloredTextRegions).toEqual([]);
    view.setTextColorRegions(structuredClone(regions));
    expect(tasks.length).toBe(1);
    expect(view.renderedTextColorRegions).toEqual(regions);
    expect(view.thumbnailCanvas).toBeNull();
  });

  it("does not publish obsolete work, even if it finished just before cancellation", async function () {
    view.setTextColorRegions(regions);
    tasks[0].resolve();
    const latest = [{ rect: [20, 80, 60, 90], color: "#245e91" }];
    view.setTextColorRegions(latest);
    await tasks[0].promise;
    expect(view.coloredTextRegions).toEqual([]);
    await complete(tasks[1]);
    expect(view.coloredTextRegions).toEqual(latest);
  });

  it("cancels pending coloring when the page is reset", async function () {
    view.setTextColorRegions(regions);
    view.reset();
    await tasks[0].promise.catch(() => {});
    expect(tasks[0].cancel).toHaveBeenCalledTimes(1);
    expect(view.canvas).toBeNull();
    expect(view.coloredTextRegions).toEqual([]);
  });

  it("uses the displayed viewport during CSS-only zoom", async function () {
    view.viewport = { ...viewport, width: 400, height: 320, scale: 2 };
    view.setTextColorRegions(regions);
    expect(tasks[0].context.viewport).toBe(viewport);
    expect(tasks[0].context.canvas.width).toBe(view.canvas.width);
    await complete(tasks[0]);
  });

  it("keeps a CSS rotation applied while coloring is in progress", async function () {
    view.setTextColorRegions(regions);
    view.viewport = { ...viewport, width: 160, height: 200, rotation: 90 };
    view.cssTransform({});
    const transform = view.canvas.style.transform;
    expect(transform).toContain("rotate(90deg)");
    await complete(tasks[0]);
    expect(view.canvas.style.transform).toBe(transform);
  });

  it("allows a rendered-event listener to request new regions", async function () {
    const next = [{ rect: [20, 80, 60, 90], color: "#245e91" }];
    view.eventBus.dispatch = () => view.setTextColorRegions(next);
    view.setTextColorRegions(regions);
    await complete(tasks[0]);
    expect(tasks[0].cancel).not.toHaveBeenCalled();
    expect(tasks.length).toBe(2);
    await complete(tasks[1]);
    expect(view.coloredTextRegions).toEqual(next);
  });

  it("removes coloring and restores thumbnail reuse when disabled", async function () {
    view.setTextColorRegions(regions);
    await complete(tasks[0]);
    view.setTextColorRegions([]);
    expect(view.coloredTextRegions).toEqual(regions);
    await complete(tasks[1]);
    expect(view.coloredTextRegions).toEqual([]);
    expect(view.thumbnailCanvas).toBe(view.canvas);
  });

  it("cancels pending coloring when previews are disabled", async function () {
    const previous = view.canvas;
    view.setTextColorRegions(regions);
    view.setTextColorRegions([]);
    await tasks[0].promise.catch(() => {});
    expect(tasks[0].cancel).toHaveBeenCalledTimes(1);
    expect(view.canvas).toBe(previous);
    expect(view.coloredTextRegions).toEqual([]);
    expect(tasks.length).toBe(1);
  });

  it("redraws retained regions directly after page eviction", async function () {
    view.setTextColorRegions(regions);
    await complete(tasks[0]);
    view.reset();
    await view.draw();
    expect(
      view._drawCanvas.calls.mostRecent().args[0].textColorRegions
    ).toEqual(regions);
    expect(view.coloredTextRegions).toEqual(regions);
    view.setTextColorRegions(structuredClone(regions));
    expect(tasks.length).toBe(1);
  });

  it("clears retained regions on redraw when previews were disabled while evicted", async function () {
    view.setTextColorRegions(regions);
    await complete(tasks[0]);
    view.reset();
    window.getPageTextColorRegions = () => [];
    await view.draw();
    expect(
      view._drawCanvas.calls.mostRecent().args[0].textColorRegions
    ).toEqual([]);
    expect(view.coloredTextRegions).toEqual([]);
    expect(view.thumbnailCanvas).toBe(view.canvas);
    expect(tasks.length).toBe(1);
  });

  it("paints prepared regions in the first draw, without a coloring render", async function () {
    view.reset();
    window.getPageTextColorRegions = () => regions;
    await view.draw();
    expect(
      view._drawCanvas.calls.mostRecent().args[0].textColorRegions
    ).toEqual(regions);
    expect(view.coloredTextRegions).toEqual(regions);
    expect(tasks.length).toBe(0);
  });

  for (const cssOnly of [false, true]) {
    it(`displays the canvas after ${cssOnly ? "CSS-only" : "normal"} zoom with pending citation data`, async function () {
      view.reset();
      view._drawCanvas.and.callThrough();
      if (cssOnly) {
        view.maxCanvasPixels = 5000;
      }
      view.update({ scale: 1 });
      window.getPageTextColorRegions = () => null;
      const draw = view.draw();
      view.update({ scale: 1.5 });

      if (cssOnly) {
        expect(tasks.length).toBe(1);
        await complete(tasks[0]);
        await draw;
      } else {
        await draw;
        const redraw = view.draw();
        await Promise.resolve();
        await complete(tasks.at(-1));
        await redraw;
      }

      expect(view.renderingState).toBe(RenderingStates.FINISHED);
      expect(view.canvas.isConnected).toBeTrue();
      expect(view.div.querySelectorAll("canvas").length).toBe(1);
      expect(view.renderTask).toBeNull();
    });
  }
});
