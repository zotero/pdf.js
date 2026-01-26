import { getStructuredChars } from './structure.js';
import { getLinkOverlays, getRegularLinkOverlays } from './link/link.js';
import { getPageLabels } from './page-label.js';
import { getExistingOutline } from './outline-reader.js';
import { extractOutline } from './outline-extractor.js';
import { getContentRects } from './content-rect.js';
import { intersectRects, overlaysIntersect } from './util.js';
import { getCitationAndReferenceOverlays } from './reference/reference.js';

export class Module {
  constructor(pdfDocument) {
    this._pdfDocument = pdfDocument;
  }

  _structuredCharsProvider = async (pageIndex, priority) => {
    if (!priority) {
      await new Promise(resolve => setTimeout(resolve));
    }

    let page = await this._pdfDocument.getPage(pageIndex);
    let task = {
      name: "dummy-task",
      ensureNotTerminated() {
        return true;
      },
    };

    let items = [];
    let sink = {};
    sink.enqueue = function (a, b) {
      items.push(...a.items);
    };

    try {
      await page.extractTextContent({
        handler: this._pdfDocument.pdfManager._handler,
        task,
        sink,
      });
    } catch (e) {
      console.log(e);
      throw e;
    }

    let chars = [];
    for (let item of items) {
      if (!item.chars) {
        continue;
      }
      chars.push(...item.chars);
    }

    chars = getStructuredChars(chars);

    for (let char of chars) {
      char.pageIndex = pageIndex;
    }

    return chars;
  };

  async getPageData({ pageIndex }) {
    let page = await this._pdfDocument.getPage(pageIndex);
    let r = Math.random().toString();
    let chars = await this._structuredCharsProvider(pageIndex, true);
    let overlays = await getRegularLinkOverlays(
      this._pdfDocument,
      chars,
      pageIndex
    );

    let a = await this.getPageCharsObjects(pageIndex);
    console.log("chars objects", a);


    return {
      partial: true,
      chars,
      overlays,
      viewBox: page.view,
    };
  }

  async getProcessedData({ metadataPagesField } = {}) {
    const MAX_PAGES = 100;
    await this._pdfDocument.pdfManager.ensureDoc("numPages");
    let pageLabels = await getPageLabels(
      this._pdfDocument,
      this._structuredCharsProvider
    );
    let contentRects = await getContentRects(
      this._pdfDocument,
      this._structuredCharsProvider,
      pageLabels
    );

    let structuredCharsCache = new Map();
    let customStructuredCharsProvider = async pageIndex => {
      let chars = structuredCharsCache.get(pageIndex);
      if (chars) {
        return chars;
      }
      chars = await this._structuredCharsProvider(pageIndex);
      for (let char of chars) {
        if (!intersectRects(contentRects[pageIndex], char.rect)) {
          char.isolated = true;
        }
      }
      structuredCharsCache.set(pageIndex, chars);
      return chars;
    };

    let citationAndReferenceOverlays = await getCitationAndReferenceOverlays(
      this._pdfDocument,
      customStructuredCharsProvider,
      100
    );

    let pages = new Map();

    for (let overlay of citationAndReferenceOverlays) {
      let { pageIndex } = overlay.position;
      // if (overlay.type === 'reference') {
      //   continue;
      // }
      let page = pages.get(pageIndex);
      if (!page) {
        page = { overlays: [] };
        pages.set(pageIndex, page);
      }
      page.overlays.push(overlay);
    }

    let linkOverlaysMap = await getLinkOverlays(
      this._pdfDocument,
      customStructuredCharsProvider,
      this._contentRect
    );

    for (let [pageIndex, linkOverlays] of linkOverlaysMap) {
      // Exclude link overlays that intersect reference overlays and aren't a bibliography record or external url link
      // Don't include link annotations overlays that overlap with citation overlays
      for (let linkOverlay of linkOverlays) {
        let page = pages.get(pageIndex);
        if (!page) {
          page = { overlays: [] };
          pages.set(pageIndex, page);
        }
        // Push all external links, and all internal links that doesn't intersect with citations
        // pointing to the same page as the first reference.
        if (
          linkOverlay.type === "external-link" ||
          !citationAndReferenceOverlays.some(
            x =>
              x.references.some(
                y =>
                  y.position.pageIndex ===
                  linkOverlay.destinationPosition.pageIndex
              ) && overlaysIntersect(x, linkOverlay)
          )
        ) {
          page.overlays.push(linkOverlay);
        }
      }
    }

    for (let [pageIndex, page] of pages) {
      page.viewBox = (await this._pdfDocument.getPage(pageIndex)).view;
      page.chars = await customStructuredCharsProvider(pageIndex);
    }

    pages = Object.fromEntries(pages);

    return { pageLabels, pages };
  }

  async getOutline() {
    let data = await getExistingOutline(
      this._pdfDocument,
      this._structuredCharsProvider
    );
    if (!data.length) {
      data = await extractOutline(
        this._pdfDocument,
        this._structuredCharsProvider
      );
    }
    return data || [];
  }

  async getPageChars(pageIndex) {
    return this._structuredCharsProvider(pageIndex);
  }

  async getPageCharsObjects(pageIndex) {
    let chars = await this._structuredCharsProvider(pageIndex);
    let page = await this._pdfDocument.getPage(pageIndex);

    let task = {
      name: "dummy-task",
      ensureNotTerminated() {
        return true;
      },
    };
    let data = await page.getPageContent({
      handler: this._pdfDocument.pdfManager._handler,
      task,
    });
    return { chars, objects: data.objects };
  }

  async getPageLabels() {
    if (this._pageLabelsPromise) {
      await this._pageLabelsPromise;
      return this._pageLabels;
    }
    let resolvePageLabelsPromise;
    this._pageLabelsPromise = new Promise(resolve => {
      resolvePageLabelsPromise = resolve;
    });
    let structuredCharsCache = new Map();
    let customStructuredCharsProvider = async pageIndex => {
      let chars = structuredCharsCache.get(pageIndex);
      if (chars) {
        return chars;
      }
      chars = await this._structuredCharsProvider(pageIndex);
      structuredCharsCache.set(pageIndex, chars);
      return chars;
    };

    this._pageLabels = await getPageLabels(
      this._pdfDocument,
      customStructuredCharsProvider
    );
    resolvePageLabelsPromise();
    return this._pageLabels;
  }
}
