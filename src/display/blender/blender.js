import Color from "./color.js";

class Blender {
  constructor(ctx, theme) {
    this.ctx = ctx;
    this.styleCache = new Map();

    this.background = new Color(theme.background);
    this.foreground = new Color(theme.foreground);
    this.gradient = this.background.range(this.foreground);
    this.dark = this.background.lightness < this.foreground.lightness;

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

  hasDistinctColorsOverThreshold(imageData, threshold) {
    const { data } = imageData;
    const colorSet = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const colorKey = (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | 0xff) >>> 0;
      colorSet.add(colorKey);
      if (colorSet.size > threshold) {
        return true;
      }
    }
    return false;
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

    let entirePage = dWidth >= pageWidth && dHeight >= pageHeight;

    const offCanvas = document.createElement("canvas");
    offCanvas.width = sWidth;
    offCanvas.height = sHeight;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    const imageData = offCtx.getImageData(0, 0, sWidth, sHeight);

    let colorThreshold;
    if (entirePage) {
      colorThreshold = 256;
    } else {
      // This is mainly necessary for IEEE TRANSACTIONS papers because they
      // use formulas as images instead of glyphs or vector graphics
      colorThreshold = 2;
    }

    const applyColors = !this.hasDistinctColorsOverThreshold(imageData, colorThreshold);
    const data = imageData.data;
    const whiteThreshold = 200;
    const blackThreshold = 50;
    const colorDeviation = 1;
    if (applyColors) {
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
        }
        else if (isNeutral && avg < blackThreshold) {
          data[i] = fgR;
          data[i + 1] = fgG;
          data[i + 2] = fgB;
        }
      }
      offCtx.putImageData(imageData, 0, 0);
      // draw the processed offCanvas
      if (args.length === 3) {
        this.origDrawImage(offCanvas, dx, dy);
      }
      else if (args.length === 5) {
        this.origDrawImage(offCanvas, dx, dy, dWidth, dHeight);
      }
      else {
        this.origDrawImage(offCanvas, 0, 0, sWidth, sHeight, dx, dy, dWidth, dHeight);
      }
      return;

    }

    // Set the blending mode and global alpha for controlled opacity
    this.ctx.globalCompositeOperation = "source-over"; // Blending mode (e.g., "source-over", "multiply", etc.)
    this.ctx.globalAlpha = 0.8; // Opacity of the image being blended (0 = fully transparent, 1 = fully opaque)
    this.origDrawImage(...args);
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
