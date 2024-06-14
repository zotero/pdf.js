import { getPositionFromRects, getSortIndex } from '../../util.js';

function isYear(word) {
  let number = parseInt(word);
  return (
    word.length === 4 &&
    number == word &&
    number >= 1800 &&
    number <= new Date().getFullYear()
  );
}

function isName(word) {
  return word.length >= 2 && word[0] === word[0].toUpperCase();
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

function getReferenceIndex(references) {
  let index = new Map();
  for (let reference of references) {
    // console.log('reference', reference, references)
    let addingNames = true;
    let addingYear = true;
    let word = [];
    let wordOffsetFrom = 0;
    for (let i = 0; i < reference.chars.length; i++) {
      let char = reference.chars[i];
      word.push(char);
      if (char.wordBreakAfter) {
        let text = word.map(x => x.c).join('');
        let type;
        if (isName(text)) {
          type = 'name';
        } else if (isYear(text)) {
          type = 'year';
        }

        // Stop adding names if title begins
        if (['“', '‘'].includes(text[0])) {
          addingNames = false;
        }

        if (type === 'name' && addingNames === true || type === 'year' && addingYear) {
          let existing = index.get(text);
          if (existing) {
            if (!existing.has(reference)) {
              existing.set(reference, wordOffsetFrom);
            }
          } else {
            index.set(text, new Map([[reference, wordOffsetFrom]]));
          }

          // Stop adding words to the index after a year is encountered.
          // It's very unlikely that author names can come after it
          if (type === 'year') {
            break;
          }
        }
        word = [];
        wordOffsetFrom = i + 1;
      }
    }
  }
  return index;
}

function getRegularWordsIndex(combinedChars) {
  let index = new Set();
  let word = [];
  let wordOffsetFrom = 0;
  for (let i = 0; i < combinedChars.length; i++) {
    let char = combinedChars[i];
    word.push(char);
    if (char.wordBreakAfter) {
      let text = word.map(x => x.c).join('');
      let lower = text.toLowerCase();
      let upper = text.toUpperCase();

      if (lower !== upper && text === lower) {
        index.add(text);
      }

      word = [];
      wordOffsetFrom = i + 1;
    }
  }
  return index;
}

export function matchByNameAndYear(combinedChars, references) {
  let index = getReferenceIndex(references);
  let regularWordsIndex = getRegularWordsIndex(combinedChars);
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
        if (result/* && !isYear(text)*/ && !regularWordsIndex.has(text.toLowerCase())) {

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
