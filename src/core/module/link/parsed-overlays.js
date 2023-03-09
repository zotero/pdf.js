import { getRangeRects, getSortIndex } from '../util.js';

export function getParsedOverlays(chars) {
  if (!chars.length) {
    return [];
  }
  let sequences = [];
  let sequence = { from: 0, to: 0, lbp: [] };

  let urlBreakChars = ['/', '-', '_', '.', '?', '&', '=', ':', '#', ';', ',', '+', '~', '@', '!'];

  for (let i = 0; i < chars.length; i++) {
    let char = chars[i];
    let charBefore = chars[i - 1];

    if ((!charBefore || charBefore.spaceAfter)
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
      // Only add single character even if it maps to multiple
      // characters (ligature). Also make sure char.c isn't empty,
      // even though that might never happen
      text += char.c[0] || '_';
    }
    let match = text.match(urlRegExp);
    if (match) {
      let from = sequence.from + match.index;
      let to = from + match[0].length;
      let url = chars.slice(from, to).map(x => x.c).join('');
      if (url.includes('@')) {
        continue;
      }
      url = url.replace(/[.)]*$/, '');
      links.push({ from, to, url });
    }
    match = text.match(doiRegExp);
    if (match) {
      let from = sequence.from + match.index;
      let to = from + match[0].length;
      let doi = chars.slice(from, to).map(x => x.c).join('');
      let url = 'https://doi.org/' + encodeURIComponent(doi);
      links.push({ from, to, text: doi, url });
      continue;
    }
  }

  let { pageIndex } = chars[0];

  let overlays = [];
  for (let link of links) {
    let rects = getRangeRects(chars, link.from, link.to - 1);
    let overlay = {
      type: 'external-link',
      source: 'parsed',
      url: link.url,
      sortIndex: getSortIndex(pageIndex, link.from, 0),
      position: {
        pageIndex,
        rects,
      },
    };
    overlays.push(overlay);
  }

  return overlays;
}
