import { getStructuredChars } from './structure.js';
import { getLinkOverlays } from './link/link.js';
import { getPageLabel } from './page-label.js';
import {
  getCitationOverlays,
  getReferenceOverlays
} from './reference-matcher.js';
import { extractReferences } from './reference-extractor.js';
import { getExistingOutline } from './outline-reader.js';
import { extractOutline } from './outline-extractor.js';
import { getContentRect } from './content-rect.js';
import { intersectRects, overlaysIntersect } from './util.js';

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

  _structuredCharsProvider = async (pageIndex, onlyContent) => {
    let cached = this._structuredCharsCache.get(pageIndex);
    if (cached) {
      return cached;
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

  async getPageData({ pageIndex, metadataPagesField }) {
    if (!this._initializing) {
      this._initializeDocument();
      this._initializing = true;
    }
    await this._initializePromise;

    let chars = await this._structuredCharsProvider(pageIndex);

    let pageLabel = await getPageLabel(this._pdfDocument, this._structuredCharsProvider, pageIndex);
    let linkOverlays = await getLinkOverlays(this._pdfDocument, this._structuredCharsProvider, this._contentRect, pageIndex);
    let citationOverlays = await getCitationOverlays(this._pdfDocument, this._structuredCharsProvider, pageIndex, this._referenceData, linkOverlays);
    let referenceOverlays = [];// await getReferenceOverlays(this._referenceData, pageIndex);

    let overlays = [...citationOverlays, ...referenceOverlays];

    // Exclude link overlays that intersect reference overlays and aren't a bibliography record or external url link
    // Don't include link annotations overlays that overlap with citation overlays
    for (let linkOverlay of linkOverlays) {
      if (!citationOverlays.some(x => overlaysIntersect(x, linkOverlay))) {
        overlays.push(linkOverlay);
      }
    }

    let page = await this._pdfDocument.getPage(pageIndex);

    return {
      pageLabel,
      chars,
      overlays,
      viewBox: page.view,
    };
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
    this._contentRect = await getContentRect(this._pdfDocument, this._structuredCharsProvider);
    await this._pdfDocument.pdfManager.ensureDoc("numPages");
    this._referenceData = await extractReferences(this._pdfDocument, this._structuredCharsProvider);
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
