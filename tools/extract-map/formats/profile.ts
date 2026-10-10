// Text tables used by "optimized" maps, which merge object data into the game's own table files:
//  - INI-style profiles (Units\*Strings.txt): [id] sections with Key=Value lines.
//  - SYLK spreadsheets (Units\*.slk): C;X<col>;Y<row>;K<value> records, row 1 = column names,
//    column 1 = row id. X/Y carry over from the previous record when omitted.

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/** Section id → first value of `key` (e.g. unit id → Name). Earlier files win, like WC3's profile merge. */
export const parseProfileKey = (texts: string[], key: string, into = new Map<string, string>()): Map<string, string> => {
  const prefix = `${key}=`;
  for (const text of texts) {
    let section = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('[') && line.endsWith(']')) {
        section = line.slice(1, -1);
      } else if (section && line.startsWith(prefix) && !into.has(section)) {
        into.set(section, unquote(line.slice(prefix.length)));
      }
    }
  }
  return into;
};

export type SlkTable = Map<string, Map<string, string>>;

/** Row id → (column name → raw value). */
export const parseSlk = (text: string): SlkTable => {
  const cells = new Map<number, Map<number, string>>();
  let x = 0;
  let y = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.startsWith('C;')) continue;
    let value: string | undefined;
    for (const part of raw.split(';').slice(1)) {
      const tag = part[0];
      if (tag === 'X') x = Number(part.slice(1));
      else if (tag === 'Y') y = Number(part.slice(1));
      else if (tag === 'K') value = unquote(part.slice(1));
    }
    if (value === undefined) continue;
    let row = cells.get(y);
    if (!row) cells.set(y, (row = new Map()));
    row.set(x, value);
  }
  const header = cells.get(1) ?? new Map<number, string>();
  const table: SlkTable = new Map();
  for (const [rowIndex, row] of cells) {
    if (rowIndex === 1) continue;
    const id = row.get(1);
    if (!id) continue;
    const out = new Map<string, string>();
    for (const [col, v] of row) {
      const name = header.get(col);
      if (name) out.set(name, v);
    }
    table.set(id, out);
  }
  return table;
};
