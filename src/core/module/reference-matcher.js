import { getRectsFromChars, getSortIndex } from './utilities.js';

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

function matchByNameAndYear(combinedChars, pageIndex, references, index, currentPageLength) {
  // TODO: Don't match names after the year
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

    let someInCurrentPage = matches.some(x => x.pageOffset <= currentPageLength - 1);

    if (hasName && minOffset < 15 && someInCurrentPage) {
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

    let position = getPositionFromRects(word, pageIndex);

    overlays.push({
      type: 'citation',
      word,
      offset,
      position,
      sortIndex: getSortIndex(pageIndex, offset, 0),
      references,
    });
  }

  overlays.sort((a, b) => a.offset - b.offset)

  return overlays;
}

function matchByNumber(combinedChars, pageIndex, references) {

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
            offsetFrom: i,
            offsetTo: i,
          };
        } else if (prevChar && prevChar.c === '(') {
          range = {
            type: 'parentheses',
            chars: [prevChar, char],
            offsetFrom: i,
            offsetTo: i,
          };
        }
      }
    }
    // After starting character collection above, continue the collection until it's one of the characters
    // below and font size doesn't change (superscript)
    else {
      let allowed = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '-', '–', '[', ']', '(', ')'];

      if (allowed.includes(char.c) && Math.abs(prevChar.fontSize - char.fontSize) < 1) {
        range.chars.push(char);
        range.offsetTo = i;

        if (['brackets', 'parentheses'].includes(range.type) && (range.chars.filter(x => ['(', '[', ']', ')'].includes(x.c)).length % 2 === 0)) {
          ranges.push(range);
          range = null;
        }
      }
      else {
        if (range.type === 'superscript') {
          ranges.push(range);
        }
        range = null;
      }
    }
  }

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
          for (let i = lastNum + 1; i < number; i++) {
            numbers.add(i);
          }
        }
        lastNum = number;
      }
      else {
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
      }
    }

    if (numbers.length !== refs.length || !refs.length) {
      continue;
    }

    let word = range.chars;

    let position = getPositionFromRects(word, pageIndex);
    overlays.push({
      type: 'citation',
      word,
      offset: range.offsetFrom,
      position,
      sortIndex: getSortIndex(pageIndex, range.offsetFrom, 0),
      references: refs,
    });
  }
  return overlays;
}

export async function getReferenceOverlays(referenceData, pageIndex) {
  if (!referenceData) {
    return [];
  }
  let { references } = referenceData;
  let overlays = [];
  for (let reference of references) {
    if (reference.position.pageIndex === pageIndex) {
      overlays.push({
        type: 'reference',
        position: reference.position,
        sortIndex: getSortIndex(pageIndex, reference.chars[0].offset, 0),
        references: [reference],
      });
    }
  }
  return overlays;
}

export async function getCitationOverlays(pdfDocument, structuredCharsProvider, pageIndex, referenceData) {
  if (!referenceData) {
    return [];
  }
  let {references, start} = referenceData;
  if (pageIndex > start.pageIndex) {
    return [];
  }

  let index = new Map();

  for (let reference of references) {
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

  let chars = await structuredCharsProvider(pageIndex);
  let combinedChars = chars.slice();

  if (pageIndex === start.pageIndex) {
    combinedChars = combinedChars.slice(0, start.offset);
  }

  let currentPageLength = combinedChars.length;

  for (let char of combinedChars) {
    char.pageIndex = pageIndex;
  }
  if (pageIndex + 1 < pdfDocument.catalog.numPages && pageIndex < start.pageIndex) {
    let chars = await structuredCharsProvider(pageIndex + 1);
    let index = chars.findIndex(x => x.lineBreakAfter);
    chars = chars.slice(0, index + 1);
    for (let char of chars) {
      char.pageIndex = pageIndex + 1;
    }
    combinedChars.push(...chars);
  }

  combinedChars = combinedChars.filter(x => !x.isolated);

  let overlays;

  if (references[0].index) {
    overlays = matchByNumber(combinedChars, pageIndex, references);
  }
  else {
    overlays = matchByNameAndYear(combinedChars, pageIndex, references, index, currentPageLength);
  }

  return overlays;
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
