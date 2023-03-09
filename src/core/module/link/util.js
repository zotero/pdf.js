import { basicDeepEqual } from '../utilities.js';

export async function getPositionFromDestination(pdfDocument, dest) {
  if (!pdfDocument || !dest) {
    // No PDF document available or invalid destination provided.
    return;
  }

  let destArray;

  // If the destination is a string, it's a named destination.
  // We'll need to resolve it to get the actual destination array.
  if (typeof dest === 'string') {
    destArray = await pdfDocument.pdfManager.ensureCatalog("getDestination", [dest]);
    if (!destArray) {
      // Unable to resolve named destination
      return;
    }
  } else {
    destArray = dest;
  }

  const ref = destArray[0];
  const pageNumber = await pdfDocument.pdfManager.ensureCatalog("getPageIndex", [ref]) + 1;
  let { rotate, view } = await pdfDocument.getPage(pageNumber - 1);
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
    pageIndex: pageNumber - 1,
    rects: [[x, y, x, y]],
  };
}

export function overlayDestinationsEqual(a, b) {
  return (
    (a.type === "internal-link" &&
      b.type === "internal-link" &&
      basicDeepEqual(a.position, b.position)) ||
    // or urls are equal if they both are external links
    (a.type === "external-link" &&
      b.type === "external-link" &&
      a.url === b.url)
  );
}
