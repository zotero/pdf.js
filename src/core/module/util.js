export function intersectRects(r1, r2) {
  return !(
    r2[0] > r1[2]
    || r2[2] < r1[0]
    || r2[1] > r1[3]
    || r2[3] < r1[1]
  );
}

export function getCenterRect(r) {
  return [
    r[0] + (r[2] - r[0]) / 2,
    r[1] + (r[3] - r[1]) / 2,
    r[0] + (r[2] - r[0]) / 2,
    r[1] + (r[3] - r[1]) / 2
  ];
}

export function getBoundingRect(chars) {
  return [
    Math.min(...chars.map(x => x.rect[0])),
    Math.min(...chars.map(x => x.rect[1])),
    Math.max(...chars.map(x => x.rect[2])),
    Math.max(...chars.map(x => x.rect[3])),
  ];
}

export function getClosestDistance(rectA, rectB) {
  // Extracting coordinates for easier understanding
  const [Ax1, Ay1, Ax2, Ay2] = rectA;
  const [Bx1, By1, Bx2, By2] = rectB;

  // Horizontal distance
  let horizontalDistance = 0;
  if (Ax2 < Bx1) { // A is left of B
    horizontalDistance = Bx1 - Ax2;
  } else if (Bx2 < Ax1) { // B is left of A
    horizontalDistance = Ax1 - Bx2;
  }

  // Vertical distance
  let verticalDistance = 0;
  if (Ay2 < By1) { // A is above B
    verticalDistance = By1 - Ay2;
  } else if (By2 < Ay1) { // B is above A
    verticalDistance = Ay1 - By2;
  }

  // If rectangles overlap in any dimension, the distance in that dimension is 0
  // The closest distance is the maximum of the horizontal and vertical distances
  return Math.max(horizontalDistance, verticalDistance);
}

// https://stackoverflow.com/a/25456134
export function basicDeepEqual(x, y) {
  if (x === y) {
    return true;
  }
  else if ((typeof x === 'object' && x != null) && (typeof y === 'object' && y !== null)) {
    if (Object.keys(x).length !== Object.keys(y).length) {
      return false;
    }
    for (let prop in x) {
      if (y.hasOwnProperty(prop)) {
        if (!basicDeepEqual(x[prop], y[prop])) {
          return false;
        }
      }
      else {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function getSortIndex(pageIndex, offset, top) {
  return [
    pageIndex.toString().slice(0, 5).padStart(5, '0'),
    offset.toString().slice(0, 6).padStart(6, '0'),
    Math.max(Math.floor(top), 0).toString().slice(0, 5).padStart(5, '0')
  ].join('|');
}

export function getRectCenter(rect) {
  const [x1, y1, x2, y2] = rect;
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;
  return [centerX, centerY];
}

export function getRangeRects(chars, offsetStart, offsetEnd) {
  let rects = [];
  let start = offsetStart;
  for (let i = start; i <= offsetEnd; i++) {
    let char = chars[i];
    if (char.lineBreakAfter || i === offsetEnd) {
      let firstChar = chars[start];
      let lastChar = char;
      let rect = [
        firstChar.rect[0],
        firstChar.inlineRect[1],
        lastChar.rect[2],
        firstChar.inlineRect[3],
      ];
      rects.push(rect);
      start = i + 1;
    }
  }
  return rects;
}

export function getRectsFromChars(chars) {
  let lineRects = [];
  let currentLineRect = null;
  for (let char of chars) {
    if (!currentLineRect) {
      currentLineRect = char.inlineRect.slice();
    }
    currentLineRect = [
      Math.min(currentLineRect[0], char.inlineRect[0]),
      Math.min(currentLineRect[1], char.inlineRect[1]),
      Math.max(currentLineRect[2], char.inlineRect[2]),
      Math.max(currentLineRect[3], char.inlineRect[3])
    ];
    if (char.lineBreakAfter) {
      lineRects.push(currentLineRect);
      currentLineRect = null;
    }
  }
  if (currentLineRect) {
    lineRects.push(currentLineRect);
  }
  return lineRects;
}

export function printOutline(items, level = 0) {
  let result = '';

  items.forEach(item => {
    // Indentation is based on the level in the hierarchy
    let indentation = '  '.repeat(level);
    result += `${indentation}${item.title}\n`;

    // If the item has items, recursively process them with incremented level
    if (item.items && item.items.length > 0) {
      result += printOutline(item.items, level + 1);
    }
  });

  if (level === 0) {
    console.log(result);
  }
  else {
    return result;
  }
}

export function getClusters(objects, property, eps) {
  if (!objects.length) {
    return [];
  }
  // Sort objects based on the specified property
  objects = objects.slice();
  objects.sort((a, b) => a[property] - b[property]);

  let clusters = [];
  let currentCluster = [objects[0]];

  for (let i = 1; i < objects.length; i++) {
    const object = objects[i];
    const distance = Math.abs(object[property] - currentCluster[currentCluster.length - 1][property]);

    // Add to current cluster if within eps; otherwise, start a new cluster
    if (distance <= eps) {
      currentCluster.push(object);
    } else {
      clusters.push(currentCluster);
      currentCluster = [object];
    }
  }

  clusters.push(currentCluster);
  return clusters;
}

export function overlaysIntersect(overlay1, overlay2) {
  if (overlay1.position.pageIndex === overlay2.position.pageIndex) {
    for (let r1 of overlay1.position.rects) {
      for (let r2 of overlay2.position.rects) {
        if (intersectRects(r1, r2)) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function getPositionFromDestination(pdfDocument, dest) {
  if (!pdfDocument || !dest || !dest.length) {
    // No PDF document available or invalid destination provided.
    return;
  }

  let destArray;

  // If the destination is a string, it's a named destination.
  // We'll need to resolve it to get the actual destination array.
  if (typeof dest === 'string') {
    try {
      destArray = await pdfDocument.pdfManager.ensureCatalog("getDestination", [dest]);
      if (!destArray) {
        // Unable to resolve named destination
        return;
      }
    } catch (e) {
      console.log(e);
      return;
    }
  } else {
    destArray = dest;
  }

  const ref = destArray[0];
  let pageIndex;
  try {
    pageIndex = await pdfDocument.pdfManager.ensureCatalog("getPageIndex", [ref]);
  } catch (e) {
    console.log(e);
    return;
  }
  let { rotate, view } = await pdfDocument.getPage(pageIndex);
  let width = view[2] - view[0];
  let height = view[3] - view[1];

  let x = 0, y = 0;
  const changeOrientation = rotate % 180 !== 0;
  const pageHeight = (changeOrientation ? width : height);

  switch (destArray[1].name) {
    case "XYZ":
      x = destArray[2] !== null ? destArray[2] : 0;
      y = destArray[3] !== null ? destArray[3] : pageHeight;
      break;
    case "Fit":
    case "FitB":
      break;
    case "FitH":
    case "FitBH":
      y = destArray[2] !== null ? destArray[2] : pageHeight;
      break;
    case "FitV":
    case "FitBV":
      x = destArray[2] !== null ? destArray[2] : 0;
      break;
    case "FitR":
      x = destArray[2];
      y = destArray[5];
      break;
    default:
      // Not a valid destination type.
      return;
  }

  return {
    pageIndex,
    rects: [[x, y, x, y]],
  };
}
