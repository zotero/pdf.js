import {
  getCenterRect,
  getPositionFromDestination,
  getRectsFromChars,
  getSortIndex, intersectRects
} from '../util.js';

/*
  - Number must be in a proper line, there should be enough characters (to exclude equations and formulas)
  - [] must have \p, \n, ' ' at the left, and ' ', \n, \p a at the right
  - If number has internal link and it points to the same then only use this method to determine if numbe is in-text citation
  - Also exclude all numbers with internal links that aren't pointing to reference page (to avoid author affiliatons in superscripts) https://forums.zotero.org/discussion/114783/zotero-7-beta-affiliations-interpreted-as-references#latest
  - Detect special word before number i.e Eq., Equation, Ref. Reference, etc.

  - Disable reference extraction and matching, link matching for large papers



  - Consider using isolation zones if paragraph font is completely different than the main font
  - Consider always rendering the full page in preview, but just show it with scrollbars and focused to matched or linked exact point
 */

function getPositionFromRects(chars, pageIndex) {
  let chars1 = [];
  let chars2 = [];
  for (let char of chars) {
    if (char.pageIndex === pageIndex) {
      chars1.push(char);
    }
    else {
      chars2.push(char);
    }
  }

  let position = {
    pageIndex,
    rects: getRectsFromChars(chars1),
  };
  if (chars2.length) {
    position.nextPageRects = getRectsFromChars(chars2);
  }
  return position;
}

function matchByNameAndYear(combinedChars, references, index) {
  // TODO: Don't match names after the year
  // TODO: Sort results by year offset distance from the name
  // let index = new Map();
  let matches = [];
  let matchIndex = 0;
  let word = [];
  let wordOffsetFrom = 0;
  for (let i = 0; i < combinedChars.length; i++) {
    let char = combinedChars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      if (word.length >= 2 && word[0].c === word[0].c.toUpperCase() /*&& ['De', 'Ruiter', '1998'].includes(word.map(x => x.c).join(''))*/) {
        let text = word.map(x => x.c).join('');

        // TODO: Remove ['’s', "'s", '’', "'"] and the end of word

        let result = index.get(text);
        if (result/* && !isYear(text)*/) {

          let type = 'name';
          if (isYear(text)) {
            type = 'year';
          }

          matches.push({
            type,
            text,
            references: result,
            offset: wordOffsetFrom,
            matchIndex: matchIndex++,
          });
        }
      }

      word = [];
      wordOffsetFrom = i + 1;
    }
  }

  let matches2 = new Map();

  for (let i = 0; i < matches.length; i++) {
    let match = matches[i];
    for (let [reference, offset] of match.references) {

      let obj = {
        type: match.type,
        text: match.text,
        pageOffset: match.offset,
        referenceOffset: offset,
        matchIndex: match.matchIndex,
        reference,
      };
      let existing = matches2.get(reference);
      if (existing) {
        existing.push(obj);
      } else {
        matches2.set(reference, [obj]);
      }
    }
  }

  let groups = [];

  let allMatches = matches;

  // Checks whether words pointing to the same reference can be joined into a single match group.
  // The words have to be close enough
  for (let [reference, matches] of matches2) {
    let currentGroup = [matches[0]];
    for (let i = 1; i < matches.length; i++) {
      let prevMatch = matches[i - 1];
      let match = matches[i];
      // TODO: Depending on the type
      if (canJoinMatches(combinedChars, prevMatch, match, allMatches)) {
        currentGroup.push(match);
      }
      else {
        groups.push(currentGroup);
        currentGroup = [match];
      }
    }
    groups.push(currentGroup);
  }

  // Remove poor groups
  let groups2 = [];
  for (let group of groups) {
    // Remove groups without authors
    // Remove groups where author name is far from reference beginning offset
    // etc.

    let matches = group;

    let hasName = matches.some(x => x.type === 'name');

    let minOffset = matches.reduce((acc, val) => Math.min(acc, val.referenceOffset), Infinity);

    // let someInCurrentPage = matches.some(x => x.pageOffset <= currentPageLength - 1);

    if (hasName && minOffset < 15/* && someInCurrentPage*/) {
      groups2.push(group);
    }
  }

  let offsetMatches = new Map();

  for (let matches of groups2) {
    for (let i = 0; i < matches.length; i++) {
      let match = matches[i];
      let existing = offsetMatches.get(match.pageOffset);
      if (!existing) {
        existing = [];
        offsetMatches.set(match.pageOffset, existing);
      }
      existing.push({
        index: i,
        matches,
      });
    }
  }

  let overlays = [];
  for (let [offset, values] of offsetMatches) {

    let references = values.map(x => x.matches[0].reference);

    let length = values[0].matches[values[0].index].text.length;

    let word = combinedChars.slice(offset, offset + length);

    let position = getPositionFromRects(word, word[0].pageIndex);

    overlays.push({
      type: 'citation',
      word,
      offset,
      position,
      sortIndex: getSortIndex(word[0].pageIndex, offset, 0),
      references,
    });
  }

  overlays.sort((a, b) => a.offset - b.offset)

  return overlays;
}

async function matchByNumber(pdfDocument, combinedChars, references) {

  let ranges = [];
  let range = null;

  for (let i = 0; i < combinedChars.length; i++) {
    let prevChar = combinedChars[i - 1];
    let char = combinedChars[i];

    if (!range) {
      // Detect three types of number based in text annotation: superscript, brackets, parentheses
      // Citation character capturing starts when there is no active range and a digit is encountered
      // Later [ or ( is prepended (for superscript citations it's not mandatory)
      if ('0' <= char.c && char.c <= '9') {
        // Superscript citation can be a number alone, or inside brackets/parentheses
        if (
          (char.inlineRect[3] - char.inlineRect[1]) > (char.rect[3] - char.rect[1]) * 1.5 &&
          (char.inlineRect[1] + char.inlineRect[3]) / 2 < (char.rect[1] + char.rect[3]) / 2
        ) {
          range = {
            type: 'superscript',
            pageIndex: char.pageIndex,
            chars: [char],
            offsetFrom: i,
            offsetTo: i,
          };
          if (prevChar && ['[', '('].includes(prevChar.c)) {
            range.chars.unshift(prevChar);
          }
        } else if (prevChar && prevChar.c === '[') {
          range = {
            type: 'brackets',
            chars: [prevChar, char],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        } else if (prevChar && prevChar.c === '(') {
          range = {
            type: 'parentheses',
            chars: [prevChar, char],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        } else {
          range = {
            type: 'other',
            chars: [char],
            before: [prevChar],
            pageIndex: char.pageIndex,
            offsetFrom: i,
            offsetTo: i,
          };
        }
      }
    }
    // After starting character collection above, continue the collection until it's one of the characters
    // below and font size doesn't change (superscript)
    else {
      let allowed = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '-', '–'];

      if (
        (!prevChar || prevChar.pageIndex === char.pageIndex) &&
        (
          allowed.includes(char.c) ||
          ['brackets', 'parentheses'].includes(range.type) && [']', ')'].includes(char.c)
        ) &&
        Math.abs(prevChar.fontSize - char.fontSize) < 1
      ) {
        range.chars.push(char);
        range.offsetTo = i;
      }
      else {
        ranges.push(range);
        range = null;
      }
    }
  }

  let pageIndexes = Array.from(new Set(ranges.map(x => x.pageIndex))).sort();


  let internalLinks = new Map();
  for (let pageIndex of pageIndexes) {
    let page = await pdfDocument.getPage(pageIndex);
    let annotations = await page._parsedAnnotations;
    for (let annotation of annotations) {
      annotation = annotation.data;
      let { dest, rect } = annotation;
      if (!dest || !rect) {
        continue;
      }
      let destinationPosition = await getPositionFromDestination(pdfDocument, dest);
      if (destinationPosition) {

        let list = internalLinks.get(pageIndex);
        if (!list) {
          list = [];
          internalLinks.set(pageIndex, list);
        }
        list.push({
          rect,
          destinationPosition,
        });
      }
    }
  }


  // console.log('internal links', internalLinks)

  for (let range of ranges) {
    range.destinationIndexes = [];
    let { pageIndex, chars } = range;
    let pageInternalLinks = internalLinks.get(pageIndex);
    if (pageInternalLinks) {
      for (let internalLink of pageInternalLinks) {
        for (let i = 0; i < chars.length; i++) {
          let char = chars[i];
          let centerRect = getCenterRect(char.rect);
          if (intersectRects(centerRect, internalLink.rect)) {
            let targetPageIndex = internalLink.destinationPosition.pageIndex;
            if (!range.destinationIndexes.includes(targetPageIndex)) {
              range.destinationIndexes.push(targetPageIndex);
            }
          }
        }
      }
    }
  }

  ranges = ranges.filter(x => !(x.type === 'other' && !x.destinationIndexes.length));



  let overlays = [];

  for (let range of ranges) {
    let text = range.chars.map(x => x.c).join('');

    let parts = text.match(/(\d+|\D+)/g);

    let numbers = new Set();

    let lastNum = null;
    let fillInterval = false;
    for (let part of parts) {
      let number = parseInt(part);
      if (number) {
        numbers.add(number);
        if (fillInterval) {
          // Fill the interval but make sure it doesn't grow uncontrollably
          for (let i = lastNum + 1; i < number && numbers.size < 50; i++) {
            numbers.add(i);
          }
        }
        lastNum = number;
      } else {
        if (part.split('').some(x => ['-', '–'].includes(x))) {
          fillInterval = true;
        }
        continue;
      }
      fillInterval = false;
    }

    numbers = Array.from(numbers).sort((a, b) => a - b);

    let refs = [];

    for (let number of numbers) {
      let reference = references.find(x => x.index === number);
      if (reference) {
        refs.push(reference);
        range.internalLinkType = 0;
        if (range.destinationIndexes.length) {
          range.internalLinkType = range.destinationIndexes.includes(reference.position.pageIndex) ? 1 : -1;
        }
      }
    }

    range.numbers = numbers;
    range.references = refs;

    // if (numbers.length !== refs.length || !refs.length) {
    //   continue;
    // }
  }

  ranges = ranges.filter(x => x.internalLinkType !== -1);
  ranges = ranges.filter(x => x.numbers.length);
  ranges = ranges.filter(x => x.references.length);



  // for (let range of ranges) {
  //   console.log(range.type, range.chars.map(x => x.c).join(''), range);
  // }


  let groups = new Map();
  for (let range of ranges) {
    let char = range.chars.find(x => x.c >= '0' && x.c <= '9');

    let id = range.type + '-' + (Math.round(char.fontSize * 10) / 10).toString() + '-' + char.fontName + '-' + range.internalLinkType;

    let group = groups.get(id);
    if (!group) {
      group = {
        ranges: [],
        references: new Set(),
      };
      groups.set(id, group);
    }

    group.ranges.push(range);
    for (let reference of range.references) {
      group.references.add(reference);
    }
  }

  let bestGroup;
  for (let [id, group] of groups) {
    if (!bestGroup || bestGroup.references.size < group.references.size) {
      bestGroup = group;
    }
  }
  if (!bestGroup) {
    return [];
  }

  for (let range of bestGroup.ranges) {

    let { references } = range;

    let word = range.chars;

    let position = getPositionFromRects(word, range.chars[0].pageIndex);
    overlays.push({
      type: 'citation',
      word,
      offset: range.offsetFrom,
      position,
      sortIndex: getSortIndex(range.chars[0].pageIndex, range.offsetFrom, 0),
      references,
    });
  }
  return overlays;
}

export async function getOverlays(pdfDocument, combinedChars, references) {
  let index = new Map();


  for (let reference of references) {
    // console.log('reference', reference, references)
    let word = [];
    let wordOffsetFrom = 0;
    for (let i = 0; i < reference.chars.length; i++) {
      let char = reference.chars[i];
      word.push(char);
      if (char.wordBreakAfter) {

        if (word.length >= 2 && word[0].c === word[0].c.toUpperCase()) {
          let text = word.map(x => x.c).join('');
          let existing = index.get(text);
          if (existing) {
            if (!existing.has(reference)) {
              existing.set(reference, wordOffsetFrom);
            }
          } else {
            index.set(text, new Map([[reference, wordOffsetFrom]]));
          }
          // Stop adding words to the index after a year is encountered.
          // It's very unlikely that author names come after it
          if (text.length === 4 && parseInt(text) == text && ['1', '2'].includes(text[0])) {
            break;
          }
        }
        word = [];
        wordOffsetFrom = i + 1;
      }
    }
  }

  let citationOverlays;

  if (references[0].index) {
    citationOverlays = await matchByNumber(pdfDocument, combinedChars, references);
  }
  else {
    citationOverlays = matchByNameAndYear(combinedChars, references, index);
  }





  let referenceMap = new Map();

  for (let citationOverlay of citationOverlays) {
    for (let reference of citationOverlay.references) {
      let group = referenceMap.get(reference);
      if (!group) {
        group = [];
        referenceMap.set(reference, group);
      }
      group.push(citationOverlay)
    }
  }

  let referenceOverlays = [];
  for (let [reference, citationOverlays] of referenceMap) {
    let { pageIndex, offset } = reference.chars[0];
    let referenceOverlay = {
      type: 'reference',
      position: reference.position,
      sortIndex: getSortIndex(pageIndex, offset, 0),
      references: [reference],
      citations: [],
    };

    for (let citationOverlay of citationOverlays) {
      let { word, offset, position } = citationOverlay;
      referenceOverlay.citations.push({ word, offset, position });
    }

    referenceOverlays.push(referenceOverlay);
  }

  return { citationOverlays, referenceOverlays };
}

function canJoinMatches(chars, match1, match2, matches) {
  let offsetFrom = match1.pageOffset + match1.text.length;
  let offsetTo = match2.pageOffset;
  let text = chars.slice(offsetFrom, offsetTo - 1).map(x => x.c).join('');

  let words = [];
  let word = [];
  for (let i = offsetFrom; i < offsetTo; i++) {
    let char = chars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      words.push(word);
      word = [];
    }
  }

  let innerMatches = matches.slice(match1.matchIndex + 1, match2.matchIndex);

  if (match1.type === 'name' && match2.type === 'name') {
    return match1.referenceOffset < match2.referenceOffset && text.length < 10 && !text.split('').some(c => [';', ')'].includes(c));
  } else {
    return text.length < 30 && ((match1.matchIndex + 1 === match2.matchIndex) || !innerMatches.some(x => x.type === 'name')) && !text.split('').some(c => [';', ')'].includes(c));
  }
}

function isYear(word) {
  return word.length === 4 && parseInt(word) == word;
}
