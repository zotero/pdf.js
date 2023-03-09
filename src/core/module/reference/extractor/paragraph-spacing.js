import { getBoundingRect, getClusters } from '../../util.js';
import {
  canStartWithChar,
  getGroupsFromClusters,
  getLinesFromChars, getReferencesFromGroup,
  splitByPageIndexContinuity,
} from './common.js';

function removeItemsWithInvalidSpacing(groups) {
  let groups2 = [];
  for (let group of groups) {
    let group2 = [];
    for (let item of group) {
      let ignore = false;
      for (let j = 0; j < item.chars.length - 1; j++) {
        let char = item.chars[j];
        let nextChar = item.chars[j + 1];
        if (char.lineBreakAfter && !(char.rect[3] < nextChar.rect[1]) &&
          char.rect[1] - nextChar.rect[3] > item.spacing) {
          ignore = true;
          break;
        }
      }
      if (!ignore) {
        group2.push(item);
      }
    }
    if (group2.length) {
      groups2.push(group2);
    }
  }
  return groups2;
}

function keepContinousSequencesOnly(groups) {
  // Keep only the longest continuous sequence of references in each group
  // Note: The 'ignore' above is responsible for broking continuity
  let groups2 = [];
  for (let group of groups) {
    let currentSequence = [];
    let longestSequence = [];
    for (let i = 0; i < group.length; i++) {
      let prevItem = group[i - 1];
      let curItem = group[i];
      if (!prevItem || prevItem.offset + prevItem.chars.length !== curItem.offset) {
        if (currentSequence.length > longestSequence.length) {
          longestSequence = currentSequence.slice();
        }
        currentSequence = [curItem];
      } else {
        currentSequence.push(curItem);
      }
    }
    if (currentSequence.length > longestSequence.length) {
      longestSequence = currentSequence.slice();
    }
    if (longestSequence.length > 0) {
      groups2.push(longestSequence);
    }
  }
  return groups2;
}

function keepDenseGroupsOnly(groups) {
  // Filter groups containing at least 5 valid references in a page
  let groups2 = [];
  // Count the maximum number of valid items in page for each group
  for (let group of groups) {
    let pageItemCount = {};
    for (let item of group) {
      if (item.valid) {
        if (pageItemCount[item.pageIndex]) {
          pageItemCount[item.pageIndex]++;
        }
        else {
          pageItemCount[item.pageIndex] = 1;
        }
      }
    }
    let max = 0;
    let values = Object.values(pageItemCount);
    if (values.length) {
      max = Math.max(...values);
    }
    if (max >= 5) {
      groups2.push(group);
    }
  }
  return groups2;
}

export async function extractByParagraphSpacing(chars, sectionOffset) {
  let lines = getLinesFromChars(chars);

  let breakPoints = [];
  for (let i = 1; i < lines.length; i++) {
    let prevLine = lines[i - 1];
    let line = lines[i];
    if (sectionOffset && prevLine.offset < sectionOffset) {
      continue;
    }
    let spacing = prevLine.rect[1] - line.rect[3];
    if (spacing > 0 && canStartWithChar(line.chars[0])) {
      breakPoints.push({ offset: line.offset, text: line.text, spacing });
    }
  }

  let clusters = getClusters(breakPoints, 'spacing', 0.5);
  clusters.forEach(x => x.sort((a, b) => a.offset - b.offset));
  clusters = splitByPageIndexContinuity(clusters);
  let groups = getGroupsFromClusters(chars, clusters);
  groups = removeItemsWithInvalidSpacing(groups);
  groups = keepContinousSequencesOnly(groups);
  // Filter groups with at least 70% of valid references
  groups = groups.filter(x => x.filter(x => x.valid).length / x.length >= 0.7);
  groups = keepDenseGroupsOnly(groups);
  if (!sectionOffset) {
    groups = groups.filter(x => (chars[x[0].offset].pageIndex + 1) / (chars.at(-1).pageIndex + 1) >= 0.75);
  }
  // We expect to have only one group left here
  if (groups.length !== 1) {
    return null;
  }
  let group = groups[0];

  let references = getReferencesFromGroup(group);
  let offset = group[0].offset;
  return { references, offset };
}
