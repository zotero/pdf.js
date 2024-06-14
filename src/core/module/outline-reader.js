import { getPositionFromDestination, getSortIndex } from './util.js';

async function getSortIndexFromTitle(pdfDocument, structuredCharsProvider, title, dest){
  let position = await getPositionFromDestination(pdfDocument, dest);
  if (!position) {
    return '';
  }

  let chars = await structuredCharsProvider(position.pageIndex);

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

  return getSortIndex(position.pageIndex, offset, 0);
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
        // Disable sortIndex calculation because 2 we aren't using it yet,
        // and it causes significant slowdown for document with many papers
        // newItem.sortIndex = await getSortIndexFromTitle(pdfDocument, structuredCharsProvider, item.title, item.dest);
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
