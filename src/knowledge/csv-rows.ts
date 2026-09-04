import { BadRequestException } from '@nestjs/common';

// Bounded comma CSV: quoted commas/newlines and doubled quotes.
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closed = false;
  const fail = () =>
    new BadRequestException('유효한 CSV 행/열 형식이 필요합니다.');
  const endField = () => {
    row.push(field);
    if (row.length > 256) throw fail();
    field = '';
    closed = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    if (rows.length > 50001) throw fail();
    row = [];
  };
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === ',') endField();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      endRow();
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else {
      if (closed || char === '"') throw fail();
      field += char;
    }
    if (field.length > 100000) throw fail();
  }
  if (quoted) throw fail();
  if (field || row.length || closed) endRow();
  const nonempty = rows.filter((r) => r.some((v) => v.trim()));
  if (
    nonempty.length < 2 ||
    nonempty[0].some((v) => !v.trim()) ||
    new Set(nonempty[0].map((v) => v.trim())).size !== nonempty[0].length
  )
    throw fail();
  if (nonempty.some((r) => r.length !== nonempty[0].length)) throw fail();
  return nonempty;
}
