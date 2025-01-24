import Color from "./color.js";

class Blender {
  constructor(ctx, theme) {
    this.ctx = ctx;
    this.styleCache = new Map();

    this.background = new Color(theme.background);
    this.foreground = new Color(theme.foreground);
    this.gradient = this.background.range(this.foreground);
    this.dark = this.background.lightness < this.foreground.lightness;

    this.fullPageImageDetected = false;

    // Backup original methods
    this.origFill = this.ctx.fill.bind(this.ctx);
    this.origFillRect = this.ctx.fillRect.bind(this.ctx);
    this.origStroke = this.ctx.stroke.bind(this.ctx);
    this.origStrokeRect = this.ctx.strokeRect.bind(this.ctx);
    this.origFillText = this.ctx.fillText.bind(this.ctx);
    this.origDrawImage = this.ctx.drawImage.bind(this.ctx);

    // Intercept style properties
    this.origFillStyle = this.interceptStyleProperty("fillStyle");
    this.origStrokeSyle = this.interceptStyleProperty("strokeStyle");

    // Wrap drawing APIs
    this.ctx.fill = (...args) => { this.origFill(...args); this.deleteCachedImage(); };
    this.ctx.fillRect = (...args) => { this.origFillRect(...args); this.deleteCachedImage(); };
    this.ctx.stroke = (...args) => { this.origStroke(...args); this.deleteCachedImage(); };
    this.ctx.strokeRect = (...args) => { this.origStrokeRect(...args); this.deleteCachedImage(); };

    this.ctx.fillText = (...args) => {
      if (typeof this.ctx.fillStyle !== "string") {
        return this.origFillText(...args);
      }
      this.ctx.save();
      this.updateTextStyle(args);
      let retVal = this.origFillText(...args);
      this.ctx.restore();
      return retVal;
    };

    this.ctx.drawImage = (...args) => this.customDrawImage(args);
  }

  interceptStyleProperty(prop) {
    const proto = Object.getPrototypeOf(this.ctx);
    const descriptor = Object.getOwnPropertyDescriptor(proto, prop);

    const { get: originalGet, set: originalSet } = descriptor;
    Object.defineProperty(this.ctx, prop, {
      get: () => originalGet.call(this.ctx),
      set: v => {
        originalSet.call(this.ctx, v);
        const currentVal = originalGet.call(this.ctx);
        originalSet.call(this.ctx, this.getCanvasStyle(currentVal));
      },
      configurable: true,
      enumerable: true,
    });

    return (val) => {
      originalSet.call(this.ctx, val);
    };
  }

  /**
   * Removes all our property definitions and method wraps on this.ctx.
   */
  unwrap() {
    const proto = Object.getPrototypeOf(this.ctx);
    // Restore fillStyle and strokeStyle
    ["fillStyle", "strokeStyle"].forEach(prop => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
      Object.defineProperty(this.ctx, prop, {
        get: descriptor.get ? descriptor.get.bind(this.ctx) : undefined,
        set: descriptor.set ? descriptor.set.bind(this.ctx) : undefined,
        configurable: true,
        enumerable: true,
      });
    });
    // Restore original methods
    this.ctx.fill = proto.fill;
    this.ctx.fillRect = proto.fillRect;
    this.ctx.stroke = proto.stroke;
    this.ctx.strokeRect = proto.strokeRect;
    this.ctx.fillText = proto.fillText;
    this.ctx.drawImage = proto.drawImage;
  }

  deleteCachedImage() {
    delete this.cachedImage;
  }

  updateTextStyle(args) {
    const style = this.ctx.fillStyle;
    if (!this.hasBackgrounds) {
      return;
    }
    // text, x, y
    const bg = this.getCanvasColor(args[0], args[1], args[2]);
    const newStyle = this.getCanvasStyle(style, bg);
    if (newStyle !== style) {
      this.origFillStyle(newStyle);
    }
  }

  getCanvasStyle(style, bg) {
    if (typeof style !== "string") {
      return;
    }
    style = new Color(style);
    const key = style.hex + (bg?.hex || "");
    let newStyle = this.styleCache.get(key);
    if (!newStyle) {
      newStyle = bg ? this.getTextStyle(style, bg) : this.calcStyle(style);
      this.styleCache.set(key, newStyle);
    }
    return newStyle.toHex(style.alpha);
  }

  calcStyle(color) {
    if (color.chroma > 10) {
      if (this.dark) {
        return this.adjustColorForVisibility(this.foreground, color.hex);
      }
      return color;
    }
    const whiteL = Color.white.lightness;
    return this.gradient(1 - color.lightness / whiteL);
  }

  getTextStyle(color, textBg, minContrast = 30) {
    const diffL = clr => Math.abs(clr.lightness - textBg.lightness);

    if (this.background.deltaE(textBg) > 2.3 && diffL(color) < minContrast) {
      return [color, this.background, this.foreground].reduce((best, clr) =>
        diffL(clr) > diffL(best) ? clr : best
      );
    }
    return color;
  }

  distinctColors(imageData, cutoffThreshold) {
    const { data } = imageData;
    const colorSet = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const colorKey = (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0;
      colorSet.add(colorKey);
      if (cutoffThreshold && colorSet.size >= cutoffThreshold) {
        return colorSet.size;
      }
    }
    return colorSet.size;
  }

  averageLightness(imageData) {
    const { data } = imageData;
    let luminanceSum = 0;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      const a = data[i + 3];

      // We assume that the background under the transparent image is white.
      // But that's not necessarily right
      if (a < 64) {
        r = 255;
        g = 255;
        b = 255;
      }

      // Integer-math version of 0.2126*r + 0.7152*g + 0.0722*b
      // (scaled by 10 000 to keep precision, then shifted back down)
      luminanceSum += (2126 * r + 7152 * g + 722 * b) >>> 0;
    }

    const pixelCount = data.length >> 2;// divide by 4
    const avg = luminanceSum / pixelCount; // still scaled ×10 000
    return Math.round(avg / 10_000); // scale back to 0 … 255
  }

  getTransformedBoundingBox(ctx, dx, dy, dWidth, dHeight) {
    // Helper function to transform points using the canvas transform matrix
    function transformPoint(matrix, x, y) {
      return {
        x: matrix.a * x + matrix.c * y + matrix.e,
        y: matrix.b * x + matrix.d * y + matrix.f,
      };
    }

    // Get the current transformation matrix
    const transform = ctx.getTransform();

    // Define the original corners of the image
    const topLeft = transformPoint(transform, dx, dy); // Top-left corner
    const topRight = transformPoint(transform, dx + dWidth, dy); // Top-right corner
    const bottomLeft = transformPoint(transform, dx, dy + dHeight); // Bottom-left corner
    const bottomRight = transformPoint(transform, dx + dWidth, dy + dHeight); // Bottom-right corner

    // Find the min and max x and y values
    const minX = Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const maxX = Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x);
    const minY = Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);
    const maxY = Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y);

    // Return the bounding box
    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  customDrawImage(args) {
    this.hasBackgrounds = true;
    delete this.cachedImage;

    const img = args[0];
    if (!img) {
      return this.origDrawImage(...args);
    }

    const [bgR, bgG, bgB] = this.background.rgb.map(e => e * 255);
    const [fgR, fgG, fgB] = this.foreground.rgb.map(e => e * 255);

    let sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight;
    if (args.length === 3) {
      [dx, dy] = [args[1], args[2]];
      sWidth = img.naturalWidth || img.width;
      sHeight = img.naturalHeight || img.height;
      [sx, sy, dWidth, dHeight] = [0, 0, sWidth, sHeight];
    } else if (args.length === 5) {
      [dx, dy, dWidth, dHeight] = [args[1], args[2], args[3], args[4]];
      sWidth = img.naturalWidth || img.width;
      sHeight = img.naturalHeight || img.height;
      [sx, sy] = [0, 0];
    } else if (args.length === 9) {
      [sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight] = args.slice(1);
    } else {
      return this.origDrawImage(...args);
    }

    const pageWidth = this.ctx.canvas.width;
    const pageHeight = this.ctx.canvas.height;

    const { width, height } = this.getTransformedBoundingBox(this.ctx, dx, dy, dWidth, dHeight);
    const entirePage = Math.abs(pageWidth * pageHeight - width * height) < pageWidth * pageHeight * 0.25;

    const offCanvas = document.createElement("canvas");
    offCanvas.width = sWidth;
    offCanvas.height = sHeight;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    const imageData = offCtx.getImageData(0, 0, sWidth, sHeight);

    let type = "overlay";

    if (this.forceInversion) {
      type = "invert";
    } else {
      if (entirePage) {
        if (!this.fullPageImageDetected) {
          this.fullPageImageDetected = true;
          const lightness = this.averageLightness(imageData);
          if (this.dark && lightness >= 150) {
            type = "invert";
            this.forceInversion = true;
          }
        }
      }
      // This is mainly necessary for IEEE TRANSACTIONS papers because they
      // use formulas as images instead of glyphs or vector graphics
      else {
        const distinctColors = this.distinctColors(imageData, 3);
        if (distinctColors <= 2) {
          type = "replace";
        }
      }
    }

    const data = imageData.data;

    if (type === "replace") {
      const whiteThreshold = 200;
      const blackThreshold = 50;
      const colorDeviation = 1;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const avg = (r + g + b) / 3;
        const isNeutral = this.isColorNeutral(r, g, b, colorDeviation);
        if (isNeutral && avg > whiteThreshold) {
          data[i] = bgR;
          data[i + 1] = bgG;
          data[i + 2] = bgB;
        } else if (isNeutral && avg < blackThreshold) {
          data[i] = fgR;
          data[i + 1] = fgG;
          data[i + 2] = fgB;
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      // draw the processed offCanvas
      if (args.length === 3) {
        this.origDrawImage(offCanvas, dx, dy);
      } else if (args.length === 5) {
        this.origDrawImage(offCanvas, dx, dy, dWidth, dHeight);
      } else {
        this.origDrawImage(offCanvas, 0, 0, sWidth, sHeight, dx, dy, dWidth, dHeight);
      }
    } else if (type === "invert") {
      // perceptual weights for relative luminance
      const LUMA_R = 0.299;
      const LUMA_G = 0.587;
      const LUMA_B = 0.114;

      for (let i = 0; i < data.length; i += 4) {
        // 1. invert the source pixel
        const invR = 255 - data[i];
        const invG = 255 - data[i + 1];
        const invB = 255 - data[i + 2];

        // 2. calculate brightness in [0 … 1]
        const brightness =
          (invR * LUMA_R + invG * LUMA_G + invB * LUMA_B) / 255;

        // 3. shift towards theme fg / bg depending on brightness:
        // brightness = 0   → use background color
        // brightness = 0.5 → keep pure inverted color
        // brightness = 1   → use foreground color
        const factor = (brightness - 0.5) * 2; // range [-1 … 1]

        let outR = invR;
        let outG = invG;
        let outB = invB;

        if (factor > 0) {
          // pull towards foreground
          outR = invR + factor * (fgR - invR);
          outG = invG + factor * (fgG - invG);
          outB = invB + factor * (fgB - invB);
        } else if (factor < 0) {
          // pull towards background
          const t = -factor; // positive weight
          outR = invR + t * (bgR - invR);
          outG = invG + t * (bgG - invG);
          outB = invB + t * (bgB - invB);
        }

        // 4. write back (rounded & clamped just in case)
        data[i] = Math.min(255, Math.max(0, Math.round(outR)));
        data[i + 1] = Math.min(255, Math.max(0, Math.round(outG)));
        data[i + 2] = Math.min(255, Math.max(0, Math.round(outB)));
      }

      // push the processed pixels to the off-screen canvas …
      offCtx.putImageData(imageData, 0, 0);

      // … and draw it back using the same geometry logic as before
      if (args.length === 3) {
        this.origDrawImage(offCanvas, dx, dy);
      } else if (args.length === 5) {
        this.origDrawImage(offCanvas, dx, dy, dWidth, dHeight);
      } else {
        this.origDrawImage(offCanvas, 0, 0, sWidth, sHeight, dx, dy, dWidth, dHeight);
      }
    } else if (type === "overlay") {
      // Set the blending mode and global alpha for controlled opacity
      this.ctx.globalCompositeOperation = "source-over"; // Blending mode (e.g., "source-over", "multiply", etc.)
      this.ctx.globalAlpha = 0.8; // Opacity of the image being blended (0 = fully transparent, 1 = fully opaque)
      this.origDrawImage(...args);
    }
  }

  isColorNeutral(r, g, b, dev) {
    const r_g = Math.abs(r - g);
    const r_b = Math.abs(r - b);
    const g_b = Math.abs(g - b);
    return r_g < dev && r_b < dev && g_b < dev;
  }

  getCanvasColor(text, tx, ty) {
    if (!this.cachedImage) {
      const canvasWidth = this.ctx.canvas.width;
      const canvasHeight = this.ctx.canvas.height;
      this.cachedImage = this.ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    }

    const mtr = this.ctx.measureText(text);
    const dx = mtr.width / 2;
    const dy = (mtr.actualBoundingBoxAscent - mtr.actualBoundingBoxDescent) / 2;

    const tfm = this.ctx.getTransform();
    let { x, y } = tfm.transformPoint({ x: tx + dx, y: ty - dy });
    x = Math.round(x);
    y = Math.round(y);

    const canvasWidth = this.ctx.canvas.width;
    const canvasHeight = this.ctx.canvas.height;
    if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) {
      console.warn("Coordinates out of bounds for canvas size.");
      return new Color([0, 0, 0]);
    }

    const index = (y * canvasWidth + x) * 4;
    const data = this.cachedImage.data;
    const rgb = [
      data[index] / 255,
      data[index + 1] / 255,
      data[index + 2] / 255,
    ];
    return new Color(rgb);
  }

  adjustColorForVisibility(background, color) {
    const bg = new Color(background);
    const fg = new Color(color);

    // Get original color's properties
    const [origL, origA, origB] = fg.lab;
    const origChroma = Math.sqrt(origA ** 2 + origB ** 2);
    const hue = origChroma > 0 ? Math.atan2(origB, origA) : 0;

    const targetL =
      bg.lightness < 50
        ? 50 + (100 - bg.lightness) * 0.3
        : 25 + bg.lightness * 0.3;

    const targetChroma = Math.max(origChroma * 1.2, 20);
    const targetA = Math.cos(hue) * targetChroma;
    const targetB = Math.sin(hue) * targetChroma;

    const newColor = new Color([targetL, targetA, targetB], "lab");
    return newColor;
  }
}

export { Blender };
