import { distance } from './lib/levenstein.js';
import { getPageLabel } from './page-label.js';
import { getCenterRect, getClusters, getRectCenter } from './utilities.js';

// TODO: Take into account horizontal pages

function getLinesFromChars(chars) {
  let lines = [];
  let line = null;
  for (let char of chars) {
    if (line) {
      line.rect[0] = Math.min(line.rect[0], char.rect[0]);
      line.rect[1] = Math.min(line.rect[1], char.rect[1]);
      line.rect[2] = Math.max(line.rect[2], char.rect[2]);
      line.rect[3] = Math.max(line.rect[3], char.rect[3]);
      line.chars.push(char);
    } else {
      line = {
        rect: char.rect.slice(),
        chars: [char],
      };
    }
    if (char.lineBreakAfter) {
      lines.push(line);
      line = null;
    }
  }

  for (let line of lines) {
    line.text = line.chars.map(x => x.c).join('');
    line.centerY = getCenterRect(line.rect)[1];
  }
  return lines;
}

export async function getContentRect(pdfDocument, structuredCharsProvider) {
  let numPages = pdfDocument.catalog.numPages;
  let pageIndex = Math.floor(numPages / 2);
  let startPage = Math.max(pageIndex - 2, 0);
  let endPage = Math.min(pageIndex + 2, numPages - 1);

  let x;

  let combinedLines = [];
  for (let i = startPage; i <= endPage; i++) {
    let chars = await structuredCharsProvider(i);
    if (!x) x = chars[2743];
    let lines = getLinesFromChars(chars);
    combinedLines.push(...lines);
  }

  let clusters = getClusters(combinedLines, 'centerY', 0.2);

  combinedLines = [];

  for (let cluster of clusters) {
    let removeLines = new Set();
    for (let i = 0; i < cluster.length; i++) {
      let currentLine = cluster[i];
      for (let j = 0; j < cluster.length; j++) {
        if (i === j || removeLines.has(i) && removeLines.has(j)) {
          continue;
        }
        let otherLine = cluster[j];
        let dist = distance(currentLine.text, otherLine.text);
        let stringsEqual = dist / currentLine.text.length <= 0.2;
        if (stringsEqual) {
          removeLines.add(i);
          removeLines.add(j);
        }
      }
    }
    for (let i = 0; i < cluster.length; i++) {
      let line = cluster[i];
      if (!removeLines.has(i)) {
        combinedLines.push(line);
      }
    }
  }

  let max = combinedLines.reduce((acc, cur) => cur.rect[0] < acc.rect[0] ? cur : acc, combinedLines[0])

  let eps = 0.1;
  let rect = [
    Math.min(...combinedLines.map(x => x.rect[0])) + eps,
    Math.min(...combinedLines.map(x => x.rect[1])) + eps,
    Math.max(...combinedLines.map(x => x.rect[2])) - eps,
    Math.max(...combinedLines.map(x => x.rect[3])) - eps,
  ];

  for (let i = startPage; i <= endPage; i++) {
    let pageLabel = await getPageLabel(pdfDocument, structuredCharsProvider, i);
    if (!pageLabel) {
      continue;
    }
    let { rotate, view } = await pdfDocument.getPage(i);
    let width = view[2] - view[0];
    let height = view[3] - view[1];

    let centerRect = getRectCenter(pageLabel.rect);
    if (centerRect[1] < height / 8) {
      rect[1] = Math.max(rect[1], pageLabel.rect[3] + eps);
    }
    else if (centerRect[1] > (height / 8) * 7) {
      rect[3] = Math.min(rect[3], pageLabel.rect[1] - eps);
    }
  }

  let { view } = await pdfDocument.getPage(numPages === 2 ? 1 : 0);
  let width = view[2] - view[0];
  rect[0] = 0;
  rect[2] = width;

  return rect;
}
