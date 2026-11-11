// The parts of a screen that shows one page of a list: the Previous and Next buttons and the page note.

// The buttons of the pages before and after this one; data gives the button data of a page.
export function pagingButtons(
  page: number,
  pages: number,
  data: (page: number) => string,
): { text: string; callback_data: string }[] {
  const buttons: { text: string; callback_data: string }[] = [];
  if (page > 0) buttons.push({ text: "Previous", callback_data: data(page - 1) });
  if (page < pages - 1) buttons.push({ text: "Next", callback_data: data(page + 1) });
  return buttons;
}

// " (page 2 of 3)" after a title; nothing when there is one page.
export const pageNote = (page: number, pages: number): string => (pages > 1 ? ` (page ${page + 1} of ${pages})` : "");
