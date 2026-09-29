// Run after: npx gulp generic-legacy
import assert from "node:assert/strict";
import Color from "../src/display/blender/color.js";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "../build/generic-legacy/build/pdf.mjs";
import test from "node:test";

function makePDF(
  content,
  {
    resources = "",
    objects: extraObjects = [],
    catalog = "",
    font = "Helvetica",
  } = {}
) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 160] " +
      `/Resources << /Font << /F1 4 0 R >> ${resources} >> /Contents 5 0 R >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
    stream(content),
    ...extraObjects,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function stream(content, entries = "") {
  return `<< /Length ${content.length} ${entries} >>\nstream\n${content}\nendstream`;
}

const text = "BT /F1 24 Tf 20 72 Td (ABC) Tj ET";
const regions = [{ rect: [18, 64, 38, 100], color: "#245e91" }];
const sepia = { background: "#f4ecd8", foreground: "#5b4636" };
const dark = { background: "#2e3440", foreground: "#d8dee9" };
const imageFixture = {
  resources: "/XObject << /Im 6 0 R >>",
  objects: [
    stream(
      "808080>",
      "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode"
    ),
  ],
};

function assertInk(pixels, ink) {
  const rgb = new Color(ink).rgb.map(c => Math.round(c * 255));
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (rgb.every((c, j) => pixels[i + j] === c)) {
      count++;
    }
  }
  assert.ok(count > 100, `Expected actual glyph pixels in ${ink}`);
}

async function withPage(content, run, fixtureOptions) {
  const loadingTask = getDocument({
    data: makePDF(content, fixtureOptions),
    standardFontDataUrl: new URL("../external/standard_fonts/", import.meta.url)
      .pathname,
  });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    await run(
      async (options = {}) => {
        const viewport = page.getViewport({
          scale: 1.5,
          rotation: options.rotation || 0,
        });
        const width = Math.ceil(viewport.width * 2);
        const height = Math.ceil(viewport.height * 2);
        const entry = doc.canvasFactory.create(width, height);
        const task = page.render({
          canvas: entry.canvas,
          viewport,
          transform: [2, 0, 0, 2, 0, 0],
          ...options,
        });
        assert.deepEqual(
          task.coloredTextRegions,
          [],
          "No result before completion"
        );
        await task.promise;
        const pixels = entry.context.getImageData(0, 0, width, height).data;
        doc.canvasFactory.destroy(entry);
        return {
          pixels,
          coloredRegions: task.coloredTextRegions,
          viewport,
          width,
        };
      },
      page,
      doc
    );
  } finally {
    await loadingTask.destroy();
  }
}

async function withTheme(theme, run) {
  const { window, document } = globalThis;
  globalThis.window = {
    theme,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  };
  globalThis.document = {
    createElement: () => createCanvas(1, 1),
  };
  try {
    await run();
  } finally {
    if (window === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = window;
    }
    if (document === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = document;
    }
  }
}

for (const rotation of [0, 90, 180, 270]) {
  test(`glyph coloring preserves other text and graphics at rotation ${rotation}`, async () => {
    await withPage(
      `.95 .9 .8 rg 0 0 200 160 re f\n0 g 10 50 100 3 re f\n${text}`,
      async render => {
        const baseline = await render({ rotation });
        assert.deepEqual(baseline.coloredRegions, []);
        assert.deepEqual(
          (await render({ rotation, textColorRegions: [] })).pixels,
          baseline.pixels
        );
        const colored = await render({ rotation, textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, regions);
        const rect = colored.viewport.convertToViewportRectangle(
          regions[0].rect
        );
        const left = Math.min(rect[0], rect[2]) * 2;
        const right = Math.max(rect[0], rect[2]) * 2;
        const top = Math.min(rect[1], rect[3]) * 2;
        const bottom = Math.max(rect[1], rect[3]) * 2;
        let changed = 0;
        let blue = 0;
        for (let i = 0; i < baseline.pixels.length; i += 4) {
          const a = baseline.pixels.slice(i, i + 4);
          const b = colored.pixels.slice(i, i + 4);
          if (a.every((v, j) => v === b[j])) {
            continue;
          }
          changed++;
          const x = (i / 4) % colored.width;
          const y = Math.floor(i / 4 / colored.width);
          assert.ok(x >= left && x <= right && y >= top && y <= bottom);
          assert.ok(
            a[0] < 242 || a[1] < 229 || a[2] < 204,
            "Paper is unchanged"
          );
          if (b[0] === 36 && b[1] === 94 && b[2] === 145) {
            blue++;
          }
        }
        assert.ok(changed > 100 && blue > 100);
      }
    );
  });
}

for (const [name, content, resources, objects] of [
  ["mixed visible text and hidden OCR", `${text} 3 Tr ${text}`],
  ["filled and stroked text", `2 Tr ${text}`],
  ["clipping text", `7 Tr ${text}`],
  ["negative font direction", text.replace("24 Tf", "-24 Tf")],
  ["zero opacity", `/GS gs ${text}`, "/ExtGState << /GS << /ca 0 >> >>"],
  ["partial opacity", `/GS gs ${text}`, "/ExtGState << /GS << /ca 0.5 >> >>"],
  [
    "nonstandard blend",
    `/GS gs ${text}`,
    "/ExtGState << /GS << /BM /Multiply >> >>",
  ],
  [
    "soft-masked text",
    `/GS gs ${text}`,
    "/ExtGState << /GS << /SMask << /S /Luminosity /G 6 0 R >> >> >>",
    [
      stream(
        "0.5 g 0 0 200 160 re f",
        "/Type /XObject /Subtype /Form /BBox [0 0 200 160] /Group << /S /Transparency /CS /DeviceGray >>"
      ),
    ],
  ],
  [
    "pattern-filled text",
    `/Pattern cs /P scn ${text}`,
    "/Pattern << /P 6 0 R >>",
    [
      stream(
        "0 g 0 0 2 2 re f",
        "/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 2 2] /XStep 2 /YStep 2 /Resources << >>"
      ),
    ],
  ],
  [
    "visible text with invisible Type3 glyphs",
    `${text} 3 Tr BT /F2 24 Tf 20 72 Td (A) Tj ET`,
    "/Font << /F1 4 0 R /F2 6 0 R >>",
    [
      "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /A 7 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>",
      stream("600 0 d0 0 0 600 700 re f"),
    ],
  ],
]) {
  test(`region fallback: ${name}`, async () => {
    await withPage(
      content,
      async render => {
        assert.deepEqual(
          (await render({ textColorRegions: regions })).coloredRegions,
          []
        );
      },
      { resources, objects }
    );
  });
}

test("ordinary transparency groups can still color text", async () => {
  await withPage(
    "/Fm Do",
    async render => {
      const colored = await render({ textColorRegions: regions });
      assert.deepEqual(colored.coloredRegions, regions);
      assert.notDeepEqual(colored.pixels, (await render()).pixels);
    },
    {
      resources: "/XObject << /Fm 6 0 R >>",
      objects: [
        stream(
          text,
          "/Type /XObject /Subtype /Form /BBox [0 0 200 160] /Group << /S /Transparency /I false /K false >> /Resources << /Font << /F1 4 0 R >> >>"
        ),
      ],
    }
  );
});

test("bitmap glyphs keep fallback only where their paint overlaps citations", async () => {
  const fixture = {
    resources: "/Font << /F1 4 0 R /F2 6 0 R >>",
    objects: [
      "<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1200 700] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /A 7 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>",
      stream(
        "600 0 0 0 1200 700 d1 q 1200 0 0 700 0 0 cm " +
          "BI /IM true /W 8 /H 8 /BPC 1 /D [1 0] /F /AHx ID\nFF818181818181FF>\nEI Q"
      ),
    ],
  };
  for (const theme of [null, dark]) {
    for (const [position, expected] of [
      ["120 30", regions],
      // The glyph's advance midpoint misses the citation, but its ink overlaps.
      ["0 72", []],
    ]) {
      const glyph = `BT /F2 24 Tf ${position} Td (A) Tj ET`;
      for (const content of [`${text} ${glyph}`, `${glyph} ${text}`]) {
        await withTheme(theme, () =>
          withPage(
            content,
            async render =>
              assert.deepEqual(
                (await render({ textColorRegions: regions })).coloredRegions,
                expected
              ),
            fixture
          )
        );
      }
    }
  }
});

test("zero-size text does not disqualify visible text", async () => {
  await withPage(text + text.replace("24 Tf", "0 Tf"), async render => {
    assert.deepEqual(
      (await render({ textColorRegions: regions })).coloredRegions,
      regions
    );
  });
});

test("unsupported text and paint in a disabled optional-content layer are ignored", async () => {
  await withPage(
    `${text} /OC /Hidden BDC 0 g 0 0 200 160 re f 1 Tr ${text} EMC`,
    async render =>
      assert.deepEqual(
        (await render({ textColorRegions: regions })).coloredRegions,
        regions
      ),
    {
      resources: "/Properties << /Hidden 6 0 R >>",
      objects: ["<< /Type /OCG /Name (hidden) >>"],
      catalog: "/OCProperties << /OCGs [6 0 R] /D << /OFF [6 0 R] >> >>",
    }
  );
});

for (const font of ["Times-Roman", "Times-Bold", "Courier", "Symbol"]) {
  test(`colors extracted character boxes with ${font}`, async () => {
    await withPage(
      text,
      async (render, page, doc) => {
        const { chars } = await doc.getPageData({ pageIndex: 0 });
        const requested = [{ rect: chars[0].rect, color: "#245e91" }];
        const original = await render();
        const colored = await render({ textColorRegions: requested });
        assert.deepEqual(colored.coloredRegions, requested);
        assert.notDeepEqual(colored.pixels, original.pixels);
      },
      { font }
    );
  });
}

test("unusual display font metrics cannot move the hit point outside extracted boxes", async () => {
  await withPage(text, async (render, page, doc) => {
    const { chars } = await doc.getPageData({ pageIndex: 0 });
    const original = await render();
    for (const [, font] of page.commonObjs) {
      if (font?.loadedName) {
        Object.defineProperties(font, {
          ascent: { value: 1.13 },
          descent: { value: -0.29 },
        });
      }
    }
    const rect = [...chars[0].rect];
    rect[3] = chars[0].baseline + chars[0].fontSize * 0.34;
    const requested = [{ rect, color: "#245e91" }];
    const colored = await render({ textColorRegions: requested });
    assert.deepEqual(colored.coloredRegions, requested);
    assert.notDeepEqual(colored.pixels, original.pixels);
  });
});

test("publishes all painted overlapping regions, not empty rectangles", async () => {
  await withPage(text, async render => {
    const painted = [...regions, { rect: [18, 64, 60, 100], color: "#245e91" }];
    const result = await render({
      textColorRegions: [
        ...painted,
        { rect: [120, 120, 160, 140], color: "#245e91" },
      ],
      operationsFilter: () => true,
    });
    assert.deepEqual(result.coloredRegions, painted);
  });
});

test("forced page colors retain fallback instead of relying on glyph hue", async () => {
  await withPage(text, async render => {
    assert.deepEqual(
      (
        await render({
          pageColors: { foreground: "#ffffff", background: "#000000" },
          textColorRegions: regions,
        })
      ).coloredRegions,
      []
    );
  });
});

test("unsupported text elsewhere does not reject a supported citation", async () => {
  await withPage(
    `${text} 1 Tr ${text.replace("20 72 Td", "120 72 Td")}`,
    async render => {
      const failed = { rect: [118, 64, 138, 100], color: "#245e91" };
      const colored = await render({ textColorRegions: [...regions, failed] });
      assert.deepEqual(colored.coloredRegions, regions);
      assert.notDeepEqual(colored.pixels, (await render()).pixels);
    }
  );
});

test("a mixed region keeps fallback regardless of glyph paint order", async () => {
  const supported = "0 Tr BT /F1 24 Tf 20 72 Td (A) Tj ET";
  const unsupported = "1 Tr BT /F1 24 Tf 40 72 Td (B) Tj ET";
  const requested = [{ rect: [18, 64, 60, 100], color: "#245e91" }];
  for (const content of [supported + unsupported, unsupported + supported]) {
    await withPage(content, async render => {
      const colored = await render({ textColorRegions: requested });
      assert.deepEqual(colored.coloredRegions, []);
      if (content.startsWith(unsupported)) {
        assert.deepEqual(colored.pixels, (await render()).pixels);
      }
    });
  }
});

test("overlapping images keep fallback before or after text; other images do not", async () => {
  const image = "q 200 0 0 160 0 0 cm /Im Do Q ";
  for (const content of [image + text, text + image, image]) {
    await withPage(
      content,
      async render => {
        const colored = await render({ textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, []);
        assert.deepEqual(colored.pixels, (await render()).pixels);
      },
      imageFixture
    );
  }
  await withPage(
    `q 20 0 0 20 150 0 cm /Im Do Q ${text}`,
    async render => {
      assert.deepEqual(
        (await render({ textColorRegions: regions })).coloredRegions,
        regions
      );
    },
    imageFixture
  );
});

for (const [name, content, expected] of [
  ["behind text", `/Sh sh ${text}`, []],
  ["over text", `${text} /Sh sh`, []],
  ["clipped elsewhere", `${text} q 120 0 20 20 re W n /Sh sh Q`, regions],
]) {
  test(`shading fallback: ${name}`, async () => {
    await withPage(
      content,
      async render => {
        const colored = await render({ textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, expected);
        if (!expected.length) {
          assert.deepEqual(colored.pixels, (await render()).pixels);
        }
      },
      {
        resources:
          "/Shading << /Sh << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 200 0] " +
          "/Function << /FunctionType 2 /Domain [0 1] /C0 [0.1 0.1 0.1] /C1 [0.2 0.2 0.2] /N 1 >> >> >>",
      }
    );
  });
}

for (const [name, background, foreground, ink] of [
  ["white", "#ffffff", "#000000", "#245e91"],
  ["sepia", "#f4ecd8", "#5b4636", "#245e91"],
  ["snow", "#eceff4", "#3b4252", "#245e91"],
  ["dark", "#2e3440", "#d8dee9", "#8fccff"],
  ["black", "#000000", "#ffffff", "#8fccff"],
  ["dim teal", "#002b36", "#839496", "#5596d9"],
  ["dim gray", "#3a3a3a", "#b0b0b0", "#77b6fb"],
]) {
  test(`visible citation ink in ${name} theme`, async () => {
    await withTheme({ background, foreground }, () =>
      withPage(text, async render => {
        const colored = await render({ textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, regions);
        assertInk(colored.pixels, ink);
        assert.ok(new Color(ink).contrast(new Color(background)) >= 4.5);
      })
    );
  });
}

test("low-contrast custom themes retain original text and fallback", async () => {
  for (const theme of [
    { background: "#c0c0c0", foreground: "#000000" },
    { background: "#555555", foreground: "#888888" },
  ]) {
    await withTheme(theme, () =>
      withPage(text, async render => {
        const colored = await render({ textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, []);
        assert.deepEqual(colored.pixels, (await render()).pixels);
      })
    );
  }
});

test("low-contrast backgrounds and later solid paint keep fallback", async () => {
  for (const [theme, content] of [
    [null, `.4 .5 .6 rg 10 60 100 45 re f 0 g ${text}`],
    [dark, `.8 .9 1 rg 10 60 100 45 re f 0 g ${text}`],
    [null, `${text} 1 g 10 60 100 45 re f`],
  ]) {
    await withTheme(theme, () =>
      withPage(content, async render => {
        const colored = await render({ textColorRegions: regions });
        assert.deepEqual(colored.coloredRegions, []);
        assert.deepEqual(colored.pixels, (await render()).pixels);
      })
    );
  }
});

test("native text drawing colors themed glyphs and retains image fallback", async () => {
  for (const [theme, content, ink] of [
    [sepia, text, "#245e91"],
    [dark, text, "#8fccff"],
    [sepia, `q 100 0 0 40 10 60 cm /Im Do Q ${text}`, null],
  ]) {
    await withTheme(theme, () =>
      withPage(
        content,
        async (render, page) => {
          await page.getOperatorList();
          // Exercise native text drawing rather than Node's glyph paths.
          const font = [...page.commonObjs].find(
            ([, obj]) => obj?.loadedName
          )?.[1];
          assert.ok(font);
          font.disableFontFace = false;
          const colored = await render({ textColorRegions: regions });
          assert.deepEqual(colored.coloredRegions, ink ? regions : []);
          if (ink) {
            assertInk(colored.pixels, ink);
          } else {
            assert.deepEqual(colored.pixels, (await render()).pixels);
          }
        },
        imageFixture
      )
    );
  }
});

test("isolated graphics groups only disqualify overlapping citation regions", async () => {
  for (const [box, expected] of [
    [[0, 0, 200, 160], []],
    [[120, 0, 200, 40], regions],
  ]) {
    const [x, y, right, top] = box;
    await withPage(
      `/Fm Do ${text}`,
      async render => {
        assert.deepEqual(
          (await render({ textColorRegions: regions })).coloredRegions,
          expected
        );
      },
      {
        resources: "/XObject << /Fm 6 0 R >>",
        objects: [
          stream(
            `0.5 g ${x} ${y} ${right - x} ${top - y} re f`,
            `/Type /XObject /Subtype /Form /BBox [${box.join(" ")}] /Group << /S /Transparency /I true >> /Resources << >>`
          ),
        ],
      }
    );
  }
});

test("transparent or clipped-out paint does not disqualify citation text", async () => {
  for (const suffix of [
    "/GS gs 0 g 0 0 200 160 re f",
    "q 120 0 20 20 re W n 0 g 0 0 200 160 re f Q",
  ]) {
    await withPage(
      `${text} ${suffix}`,
      async render => {
        assert.deepEqual(
          (await render({ textColorRegions: regions })).coloredRegions,
          regions
        );
      },
      { resources: "/ExtGState << /GS << /ca 0 >> >>" }
    );
  }
});
