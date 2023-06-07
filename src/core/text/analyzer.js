let isNum = c => c >= '0' && c <= '9';

function getSurroundedNumber(chars, idx) {
  while (
    idx > 0 && isNum(chars[idx - 1].c)
    && Math.abs(chars[idx].rect[0] - chars[idx - 1].rect[2]) < chars[idx].rect[2] - chars[idx].rect[0]
    && Math.abs(chars[idx - 1].rect[1] - chars[idx].rect[1]) < 2
    ) {
    idx--;
  }

  let str = chars[idx].c;

  while (
    idx < chars.length - 1 && isNum(chars[idx + 1].c)
    && Math.abs(chars[idx + 1].rect[0] - chars[idx].rect[2]) < chars[idx + 1].rect[2] - chars[idx + 1].rect[0]
    && Math.abs(chars[idx].rect[1] - chars[idx + 1].rect[1]) < 2
    ) {
    idx++;
    str += chars[idx].c;
  }

  return parseInt(str);
}

function getSurroundedNumberAtPos(chars, x, y) {
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    let { x: x2, y: y2 } = getRectCenter(ch.rect);
    if (isNum(ch.c) && Math.abs(x - x2) < 10 && Math.abs(y - y2) < 5) {
      return getSurroundedNumber(chars, i);
    }
  }
  return null;
}

function getRectCenter(rect) {
  return {
    x: rect[0] + (rect[2] - rect[0]) / 2,
    y: rect[1] + (rect[3] - rect[1]) / 2
  };
}

function filterNums(chars, pageHeight) {
  return chars.filter(x => x.c >= '0' && x.c <= '9' && (x.rect[3] < pageHeight * 1 / 5 || x.rect[1] > pageHeight * 4 / 5));
}

export function flattenChars(structuredText) {
  let flatCharsArray = [];
  for (let paragraph of structuredText.paragraphs) {
    for (let line of paragraph.lines) {
      for (let word of line.words) {
        for (let charObj of word.chars) {
          flatCharsArray.push(charObj);
        }
      }
    }
  }
  return flatCharsArray;
}

function getLineSelectionRect(line, charFrom, charTo) {
  if (line.vertical) {
    return [
      line.rect[0],
      Math.min(charFrom.rect[1], charTo.rect[1]),
      line.rect[2],
      Math.max(charFrom.rect[3], charTo.rect[3])
    ];
  }
  else {
    return [
      Math.min(charFrom.rect[0], charTo.rect[0]),
      line.rect[1],
      Math.max(charFrom.rect[2], charTo.rect[2]),
      line.rect[3]
    ];
  }
}

function getRangeRects(structuredText, charStart, charEnd) {
  let extracting = false;
  let rects = [];
  let n = 0;
  loop: for (let paragraph of structuredText.paragraphs) {
    for (let line of paragraph.lines) {
      let charFrom = null;
      let charTo = null;
      for (let word of line.words) {
        for (let char of word.chars) {
          if (n === charStart || extracting && !charFrom) {
            charFrom = char;
            extracting = true;
          }
          if (extracting) {
            charTo = char;
            if (n === charEnd) {
              rects.push(getLineSelectionRect(line, charFrom, charTo));
              break loop;
            }
          }
          n++;
        }
      }
      if (extracting && charFrom && charTo) {
        rects.push(getLineSelectionRect(line, charFrom, charTo));
        charFrom = null;
      }
    }
  }
  rects = rects.map(rect => rect.map(value => parseFloat(value.toFixed(3))));
  return rects;
}

function extractLinks(structuredText) {
  let chars = flattenChars(structuredText);
  let spaceBefore = new Set();
  for (let paragraph of structuredText.paragraphs) {
    for (let line of paragraph.lines) {
      for (let word of line.words) {
        if (word.spaceAfter) {
          spaceBefore.add(word.to + 1);
        }
      }
    }
  }

  let sequences = [];
  let sequence = { from: 0, to: 0, lbp: [] };

  let urlBreakChars = ['&', '.', '#', '?', '/'];

  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    let charBefore = chars[i - 1];

    if (spaceBefore.has(i)
      || charBefore && (
        char.fontSize !== charBefore.fontSize
        || char.fontName !== charBefore.fontName
        || charBefore.rect[0] > char.rect[0] && (
          charBefore.rect[1] - char.rect[3] > (char.rect[3] - char.rect[1]) / 2
          || !(urlBreakChars.includes(charBefore.c) || urlBreakChars.includes(char.c))
        )
      )
    ) {
      sequences.push(sequence);
      sequence = { from: i, to: i };
    }
    else {
      sequence.to = i;
    }
  }

  if (sequence.from !== sequence.to) {
    sequences.push(sequence);
  }

  let links = [];

  let urlRegExp = new RegExp(/(https?:\/\/|www\.|10\.)[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/);
  let doiRegExp = new RegExp(/10(?:\.[0-9]{4,})?\/[^\s]*[^\s\.,]/);

  for (let sequence of sequences) {
    let text = '';
    for (let j = sequence.from; j <= sequence.to; j++) {
      let char = chars[j];
      text += char.c;
    }
    let match = text.match(urlRegExp);
    if (match) {
      let url = match[0];
      if (url.includes('@')) {
        continue;
      }
      url = url.replace(/[.)]*$/, '');
      let from = sequence.from + match.index;
      let to = from + url.length;
      links.push({ from, to, url });
    }
    match = text.match(doiRegExp);
    if (match) {
      let from = sequence.from + match.index;
      let to = from + match[0].length;
      let url = 'https://doi.org/' + encodeURIComponent(match[0]);
      links.push({ from, to, text: match[0], url });
      continue;
    }
  }
  return links;
}

function getSortIndex(pageIndex, offset) {
  return [
    pageIndex.toString().slice(0, 5).padStart(5, '0'),
    offset.toString().slice(0, 6).padStart(6, '0'),
    (0).toString().slice(0, 5).padStart(5, '0')
  ].join('|');
}

function rectsDist([ax1, ay1, ax2, ay2], [bx1, by1, bx2, by2]) {
  let left = bx2 < ax1;
  let right = ax2 < bx1;
  let bottom = by2 < ay1;
  let top = ay2 < by1;

  if (top && left) {
    return Math.hypot(ax1 - bx2, ay2 - by1);
  }
  else if (left && bottom) {
    return Math.hypot(ax1 - bx2, ay1 - by2);
  }
  else if (bottom && right) {
    return Math.hypot(ax2 - bx1, ay1 - by2);
  }
  else if (right && top) {
    return Math.hypot(ax2 - bx1, ay2 - by1);
  }
  else if (left) {
    return ax1 - bx2;
  }
  else if (right) {
    return bx1 - ax2;
  }
  else if (bottom) {
    return ay1 - by2;
  }
  else if (top) {
    return by1 - ay2;
  }

  return 0;
}

function getClosestOffset(chars, rect) {
  let dist = Infinity;
  let idx = 0;
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    let distance = rectsDist(ch.rect, rect);
    if (distance < dist) {
      dist = distance;
      idx = i;
    }
  }
  return idx;
}

export class PageAnalyzer {
  constructor(pageIndex, pdfDocument, structuredTextProvider) {
    this._pageIndex = pageIndex;
    this._pdfDocument = pdfDocument;
    this._structuredTextProvider = structuredTextProvider;
  }

  async _getPagesNum() {
    return this._pdfDocument.pdfManager.ensureDoc('numPages');
  }

  _getPageLabelPoints(pageIndex, chars1, chars2, chars3, chars4, pageHeight) {
    let charsNum1 = filterNums(chars1, pageHeight);
    let charsNum2 = filterNums(chars2, pageHeight);
    let charsNum3 = filterNums(chars3, pageHeight);
    let charsNum4 = filterNums(chars4, pageHeight);

    // Cut off the logic if one of the pages has too many digits
    if ([charsNum1, charsNum2, charsNum3, charsNum4].find(x => x.length > 500)) {
      return null;
    }
    for (let c1 = 0; c1 < charsNum1.length; c1++) {
      let ch1 = charsNum1[c1];
      for (let c3 = 0; c3 < charsNum3.length; c3++) {
        let ch3 = charsNum3[c3];
        let { x: x1, y: y1 } = getRectCenter(ch1.rect);
        let { x: x2, y: y2 } = getRectCenter(ch3.rect);
        if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
          let num1 = getSurroundedNumber(charsNum1, c1);
          let num3 = getSurroundedNumber(charsNum3, c3);
          if (num1 && num1 + 2 === num3) {
            let pos1 = { x: x1, y: y1, num: num1, idx: pageIndex };


            let extractedNum2 = getSurroundedNumberAtPos(chars2, x1, y1);
            if (num1 + 1 === extractedNum2) {
              return [pos1];
            }

            for (let c2 = 0; c2 < charsNum2.length; c2++) {
              let ch2 = charsNum2[c2];
              for (let c4 = 0; c4 < charsNum4.length; c4++) {
                let ch4 = charsNum4[c4];
                let { x: x1, y: y1 } = getRectCenter(ch2.rect);
                let { x: x2, y: y2 } = getRectCenter(ch4.rect);
                if (Math.abs(x1 - x2) < 10 && Math.abs(y1 - y2) < 5) {
                  let num2 = getSurroundedNumber(charsNum2, c2);
                  let num4 = getSurroundedNumber(charsNum4, c4);
                  if (num1 + 1 === num2 && num2 + 2 === num4) {
                    let pos2 = { x: x1, y: y1, num: num2, idx: pageIndex + 2 };
                    return [pos1, pos2];
                  }
                }
              }
            }
          }
        }
      }
    }

    return null;
  }

  _getPageLabel(pageIndex, charsPrev, charsCur, charsNext, points) {
    let numPrev, numCur, numNext;

    // TODO: Instead of trying to extract from two positions, try to
    //  guess the right position by determining whether the page is even or odd

    // TODO: Take into account font parameters when comparing extracted numbers
    let getNum = (charsNext, points) => points.length > 0 && getSurroundedNumberAtPos(charsNext, points[0].x, points[0].y)
      || points.length > 1 && getSurroundedNumberAtPos(charsNext, points[1].x, points[1].y);

    if (charsPrev) {
      numPrev = getNum(charsPrev, points);
    }

    numCur = getNum(charsCur, points);

    if (charsNext) {
      numNext = getNum(charsNext, points);
    }

    if (numCur && (numCur - 1 === numPrev || numCur + 1 === numNext)) {
      return numCur.toString();
    }

    if (pageIndex < points[0].idx) {
      return (points[0].num - (points[0].idx - pageIndex)).toString();
    }

    return null;
  }

  async _extractPageLabelPoints(pageIndex) {
    let numPages = await this._getPagesNum();
    let start = pageIndex - 2;
    if (start < 0) {
      start = 0;
    }
    for (let i = start; i < start + 5 && i + 3 < numPages; i++) {
      let chs1 = flattenChars(await this._structuredTextProvider(i));
      let chs2 = flattenChars(await this._structuredTextProvider(i + 1));
      let chs3 = flattenChars(await this._structuredTextProvider(i + 2));
      let chs4 = flattenChars(await this._structuredTextProvider(i + 3));
      let page = await this._pdfDocument.getPage(i);
      let { view } = page;
      let pageHeight = view[3] - view[1];
      let res = this._getPageLabelPoints(i, chs1, chs2, chs3, chs4, pageHeight);
      if (res) {
        return res;
      }
    }
    return null;
  }

  async _extractPageLabel(pageIndex, points) {
    let chsPrev, chsCur, chsNext;
    if (pageIndex > 0) {
      chsPrev = flattenChars(await this._structuredTextProvider(pageIndex - 1));
    }
    chsCur = flattenChars(await this._structuredTextProvider(pageIndex));
    let numPages = await this._getPagesNum();
    if (pageIndex < numPages - 1) {
      chsNext = flattenChars(await this._structuredTextProvider(pageIndex + 1));
    }
    return this._getPageLabel(pageIndex, chsPrev, chsCur, chsNext, points);
  }

  async getPageLabel() {
    let existingPageLabels = await this._pdfDocument.pdfManager.ensureCatalog("pageLabels");
    let pageLabel;
    let points = await this._extractPageLabelPoints(this._pageIndex);
    if (points) {
      pageLabel = await this._extractPageLabel(this._pageIndex, points);
      if (!pageLabel) {
        if (existingPageLabels && existingPageLabels[this._pageIndex]) {
          pageLabel = existingPageLabels[this._pageIndex];
        }
      }
    }
    return pageLabel;
  }

  // Overlays

  async getOverlays() {
    let overlays = [];

    let pageIndex = this._pageIndex;

    let structuredText = await this._structuredTextProvider(pageIndex);
    let links = extractLinks(structuredText);
    for (let link of links) {
      let rects = getRangeRects(structuredText, link.from, link.to);
      let overlay = {
        type: 'external-link',
        source: 'parsed',
        url: link.url,
        sortIndex: getSortIndex(pageIndex, link.from),
        position: {
          pageIndex,
          rects,
        },
      };
      overlays.push(overlay);
    }

    let chars = flattenChars(structuredText);
    let page = await this._pdfDocument.getPage(pageIndex);
    let annotations = await page._parsedAnnotations;
    for (let annotation of annotations) {
      annotation = annotation.data;
      if (!annotation.url && !annotation.dest || !annotation.rect) {
        continue;
      }
      let offset = getClosestOffset(chars, annotation.rect);
      let overlay = {
        source: 'annotation',
        sortIndex: getSortIndex(pageIndex, offset),
        position: {
          pageIndex,
          rects: [annotation.rect],
        }
      };
      if (annotation.url) {
        overlay.type = 'external-link';
        overlay.url = annotation.url;
      }
      else if (annotation.dest) {
        overlay.type = 'internal-link';
        overlay.dest = annotation.dest;
      }
      else {
        continue;
      }
      overlays.push(overlay);
    }

    return overlays;
  }
}

export class OutlineAnalyzer {
  constructor(pdfDocument, structuredTextProvider) {
    this._pdfDocument = pdfDocument;
    this._structuredTextProvider = structuredTextProvider;
  }

  async getOutline(extract) {
    let outline = [];
    let items = await this._pdfDocument.pdfManager.ensureCatalog("documentOutline");
    function transformItems(items) {
      let newItems = [];
      for (let item of items) {
        let newItem = {
          title: item.title,
          location: {
            dest: item.dest,
          },
          items: transformItems(item.items),
          expanded: false,
        };
        newItems.push(newItem);
      }
      return newItems;
    }
    if (items) {
      outline = transformItems(items);
      if (outline.length === 1) {
        for (let item of outline) {
          item.expanded = true;
        }
      }
    }
    return outline;
  }
}
