import { getStructuredChars } from './structure.js';

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

    await page.extractTextContent({
      handler: this._pdfDocument.pdfManager._handler,
      task,
      sink,
    });

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

  async getPageCharsObjects(pageIndex) {
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

    let chars = getStructuredChars(data.chars);
    for (let char of chars) {
      char.pageIndex = pageIndex;
    }

    return { chars, objects: data.objects };
  }

  async getPageChars(pageIndex) {
    let { chars } = await this.getPageCharsObjects(pageIndex);
    return chars;
  }

  async getPageLabels() {
    let catalogLabels = await this._pdfDocument.pdfManager.ensureCatalog("pageLabels");
    if (Array.isArray(catalogLabels) && catalogLabels.length > 0) {
      return catalogLabels;
    }
    let numPages = this._pdfDocument.numPages;
    return Array.from({ length: numPages }, (_, i) => String(i + 1));
  }

  async getOutline() {
    return await this._pdfDocument.pdfManager.ensureCatalog("documentOutline") || [];
  }

  async getProcessedData() {
    return { pageLabels: await this.getPageLabels(), pages: {} };
  }

  async getPageData({ pageIndex }) {
    let page = await this._pdfDocument.getPage(pageIndex);
    let chars = await this._structuredCharsProvider(pageIndex, true);

    return {
      chars,
      viewBox: page.view,
    };
  }
}
