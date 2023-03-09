import { getSortIndex } from './utilities.js';

async function getPositionFromDestination(pdfDocument, dest) {
  if (!pdfDocument || !dest) {
    throw new Error("No PDF document available or invalid destination provided.");
  }

  let destArray;

  // If the destination is a string, it's a named destination.
  // We'll need to resolve it to get the actual destination array.
  if (typeof dest === 'string') {
    destArray = await pdfDocument.pdfManager.ensureCatalog("getDestination", [dest]);
    if (!destArray) {
      throw new Error(`Unable to resolve named destination: "${dest}"`);
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
      console.error(`"${destArray[1].name}" is not a valid destination type.`);
      return;
  }

  return {
    pageIndex: pageNumber - 1,
    x,
    y,
  };
}

async function getSortIndexFromTitle(pdfDocument, structuredCharsProvider, title, dest){
  let pos = await getPositionFromDestination(pdfDocument, dest);
  // TODO: Optimize this because there is no need to get the structure in this case
  let chars = await structuredCharsProvider(pos.pageIndex);

  title = title.split('').filter(x => x !== ' ');

  let offset = 0;
  let found = false;
  for (let i = 0; i < chars.length; i++) {
    for (let j = 0; i + j < chars.length && j < title.length; j++) {
      if (chars[i + j].c !== title[j]) {
        offset = i + j;
        break;
      }
    }
    if (found) {
      break;
    }
  }

  return getSortIndex(pos.pageIndex, offset, 0);
}

export async function getExistingOutline(pdfDocument, structuredCharsProvider) {
  let outline = [];
  let items = await pdfDocument.pdfManager.ensureCatalog("documentOutline");
  async function transformItems(items) {
    let newItems = [];
    for (let item of items) {
      let newItem = {
        title: item.title,
        items: await transformItems(item.items),
      };
      if (item.dest) {
        newItem.sortIndex = await getSortIndexFromTitle(pdfDocument, structuredCharsProvider, item.title, item.dest);
        newItem.location = {
          dest: item.dest,
        };
      } else if (item.unsafeUrl) {
        newItem.url = item.unsafeUrl;
      }
      newItems.push(newItem);
    }
    return newItems;
  }
  if (items) {
    outline = await transformItems(items);
    if (outline.length === 1 && outline[0].items.length > 1) {
      outline = outline[0].items;
    }
  }

  return outline;
}
