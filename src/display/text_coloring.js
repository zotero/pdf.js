/* Copyright 2012 Mozilla Foundation
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

import { F32_BBOX_INIT, TextRenderingMode, Util } from "../shared/util.js";
import {
  getCurrentTransform,
  getCurrentTransformInverse,
} from "./display_utils.js";
import Color from "./blender/color.js";

class TextColoring {
  constructor(graphics, regions, background) {
    this.graphics = graphics;
    this.context = graphics.ctx;
    this.transform = getCurrentTransformInverse(this.context);
    this.regions = new Map();
    const backgroundColor = new Color(background);
    this.context.save();
    for (const region of regions) {
      this.context.fillStyle = region.color;
      const color = new Color(this.context.fillStyle);
      const bounds = F32_BBOX_INIT.slice();
      Util.axialAlignedBoundingBox(region.rect, graphics.baseTransform, bounds);
      this.regions.set(region, {
        bounds,
        color,
        painted: false,
        failed: color.alpha !== 1 || color.contrast(backgroundColor) < 4.5,
      });
    }
    this.context.restore();
  }

  get coloredRegions() {
    return [...this.regions]
      .filter(([, state]) => state.painted && !state.failed)
      .map(([region]) => region);
  }

  recordImage(x, y, width, height) {
    this.recordPaint(
      [x, y, x + width, y + height],
      null,
      getCurrentTransform(this.graphics.ctx)
    );
  }

  recordPaint(bounds, style = null, transform = null, ctx = this.graphics.ctx) {
    if (
      !bounds ||
      !this.graphics.contentVisible ||
      ctx.globalAlpha === 0 ||
      ctx !== this.context
    ) {
      return;
    }
    if (transform) {
      const transformed = F32_BBOX_INIT.slice();
      Util.axialAlignedBoundingBox(bounds, transform, transformed);
      bounds = transformed;
    }
    // Only opaque, solid paint has a predictable background color. Images,
    // patterns and composited groups keep the fallback wherever they overlap.
    let color;
    for (const state of this.regions.values()) {
      if (!state.failed && Util.intersect(bounds, state.bounds)) {
        color ??=
          typeof style === "string" &&
          ctx.globalAlpha === 1 &&
          ctx.globalCompositeOperation === "source-over" &&
          (!ctx.filter || ctx.filter === "none")
            ? new Color(style)
            : null;
        // Paint after text may cover the cue, even if it has good contrast.
        state.failed =
          state.painted ||
          !color ||
          color.alpha !== 1 ||
          state.color.contrast(color) < 4.5;
      }
    }
  }

  matchRegion(transform, x, y, canColor) {
    const point = [x, y];
    Util.applyTransform(point, transform);
    let match;
    for (const [region, state] of this.regions) {
      const { rect } = region;
      if (
        point[0] >= rect[0] &&
        point[0] <= rect[2] &&
        point[1] >= rect[1] &&
        point[1] <= rect[3]
      ) {
        state.failed ||= !canColor;
        if (!state.failed) {
          state.painted = true;
          match ||= region;
        }
      }
    }
    return match;
  }

  beginText(glyphs) {
    const { ctx, current, contentVisible } = this.graphics;
    if (!contentVisible || current.fontSize === 0) {
      return null;
    }
    if (ctx !== this.context) {
      // Intermediate group/mask canvases have their own coordinate space.
      // Keep fallback rather than claim coverage we cannot locate reliably.
      if (glyphs.some(glyph => typeof glyph !== "number" && !glyph.isSpace)) {
        for (const state of this.regions.values()) {
          state.failed = true;
        }
      }
    } else if (current.font.isType3Font) {
      let transform = Util.transform(this.transform, getCurrentTransform(ctx));
      if (current.textMatrix) {
        transform = Util.transform(transform, current.textMatrix);
      }
      transform = Util.transform(transform, [
        current.textHScale * current.fontDirection,
        0,
        0,
        1,
        current.x,
        current.y + current.textRise,
      ]);
      let x = 0;
      for (const glyph of glyphs) {
        if (typeof glyph === "number") {
          x -= (glyph * current.fontSize) / 1000;
          continue;
        }
        const width = glyph.width * current.fontMatrix[0] * current.fontSize;
        if (!glyph.isSpace) {
          this.matchRegion(transform, x + width / 2, 0, false);
        }
        x +=
          width +
          current.charSpacing +
          (glyph.isSpace ? current.wordSpacing : 0);
      }
    }
    return this;
  }

  getTextTransform() {
    const { ctx } = this.graphics;
    return ctx === this.context
      ? Util.transform(this.transform, getCurrentTransform(ctx))
      : null;
  }

  canColorText(font, fontDirection) {
    const { ctx, current, pageColors } = this.graphics;
    return (
      !pageColors &&
      !current.activeSMask &&
      !current.patternFill &&
      !font.vertical &&
      fontDirection > 0 &&
      current.textRenderingMode === TextRenderingMode.FILL &&
      ctx.globalAlpha === 1 &&
      ctx.globalCompositeOperation === "source-over" &&
      (!ctx.filter || ctx.filter === "none")
    );
  }
}

export { TextColoring };
