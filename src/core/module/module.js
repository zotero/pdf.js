import { getStructuredChars } from './structure.js';
import { getLinkOverlays, getRegularLinkOverlays } from './link/link.js';
import { getPageLabel, getPageLabels } from './page-label.js';
// import {
//   getCitationOverlays,
//   getReferenceOverlays
// } from './reference-matcher.js';
import { getExistingOutline } from './outline-reader.js';
import { extractOutline } from './outline-extractor.js';
import { getContentRect } from './content-rect.js';
import { intersectRects, overlaysIntersect } from './util.js';
import { getCitationAndReferenceOverlays } from './reference/reference.js';

export class Module {
  constructor(pdfDocument) {
    this._pdfDocument = pdfDocument;
    this._structuredCharsCache = new Map();
    this._temporaryStructuredCharsCache = new Map();
    this._initializePromise = new Promise((resolve) => {
      this._initializePromiseResolve = resolve;
    });
    this._initializing = false;
  }

  _structuredCharsProvider = async (pageIndex, priority) => {

    let cached = this._structuredCharsCache.get(pageIndex);
    if (cached) {
      return cached;
    }

    if (!priority) {
      await new Promise((resolve) => setTimeout(resolve));
    }

    cached = this._temporaryStructuredCharsCache.get(pageIndex);
    if (cached) {
      if (this._contentRect) {
        let chars = cached;
        for (let char of chars) {
          if (!intersectRects(this._contentRect, char.rect)) {
            char.isolated = true;
          }
        }
        this._structuredCharsCache.set(pageIndex, chars)
        this._temporaryStructuredCharsCache.delete(pageIndex);
      }
      return cached;
    }

    let page = await this._pdfDocument.getPage(pageIndex);
    let task = {
      name: 'dummy-task',
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

    if (this._contentRect) {
      for (let char of chars) {
        if (!intersectRects(this._contentRect, char.rect)) {
          char.isolated = true;
        }
      }
      this._structuredCharsCache.set(pageIndex, chars);
    } else {
      this._temporaryStructuredCharsCache.set(pageIndex, chars);
    }

    return chars;
  };

  async getPageData({ pageIndex }) {
    let page = await this._pdfDocument.getPage(pageIndex);
    let r = Math.random().toString();
    let chars = await this._structuredCharsProvider(pageIndex, true);
    let overlays = await getRegularLinkOverlays(this._pdfDocument, chars, pageIndex);
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
    this._contentRect = await getContentRect(this._pdfDocument, this._structuredCharsProvider);
    let citationAndReferenceOverlays = await getCitationAndReferenceOverlays(this._pdfDocument, this._structuredCharsProvider, 100);

    let pages = new Map();

    for (let overlay of citationAndReferenceOverlays) {
      let { pageIndex } = overlay.position;
      if (overlay.type === 'reference') {
        continue;
      }
      let page = pages.get(pageIndex);
      if (!page) {
        page = { overlays: [] };
        pages.set(pageIndex, page);
      }
      page.overlays.push(overlay);
    }


    let linkOverlaysMap = await getLinkOverlays(this._pdfDocument, this._structuredCharsProvider, this._contentRect);


    for (let [pageIndex, linkOverlays] of linkOverlaysMap) {
      // Exclude link overlays that intersect reference overlays and aren't a bibliography record or external url link
      // Don't include link annotations overlays that overlap with citation overlays
      for (let linkOverlay of linkOverlays) {
        let page = pages.get(pageIndex);
        if (!page) {
          page = { overlays: [] };
          pages.set(pageIndex, page);
        }
        if (!page.overlays.some(x => overlaysIntersect(x, linkOverlay))) {
          page.overlays.push(linkOverlay);
        }
      }
    }

    for (let [pageIndex, page] of pages) {
      page.viewBox = (await this._pdfDocument.getPage(pageIndex)).view;
      page.chars = await this._structuredCharsProvider(pageIndex);
    }

    let pageLabels = await getPageLabels(this._pdfDocument, this._structuredCharsProvider);

    pages = Object.fromEntries(pages);

    return { pageLabels, pages };
  }

  async getOutline() {
    let data = await getExistingOutline(this._pdfDocument, this._structuredCharsProvider);
    if (!data.length) {
      data = await extractOutline(this._pdfDocument, this._structuredCharsProvider);
    }
    return data;
  }

  async _initializeDocument() {
    // As soon as contentRect is set, extractReferences below can use it

    this._initializePromiseResolve();
    this._initialized = true;
  }

  async getPageChars(pageIndex) {
    return this._structuredCharsProvider(pageIndex);
  }

  async getPageLabel(pageIndex) {
    let pageLabel = await getPageLabel(this._pdfDocument, this._structuredCharsProvider, pageIndex);
    return pageLabel?.chars.map(x => x.c).join('');
  }
}
