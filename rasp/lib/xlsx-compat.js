/* Separate reader engine retains source cell coordinates and merged ranges. */
window.XlsxCompat = {
  workbook(bytes) {
    const source = XLSX.read(bytes, { type: "array", cellDates: true }),
      wb = new ExcelJS.Workbook();
    for (const name of source.SheetNames) {
      const input = source.Sheets[name],
        ws = wb.addWorksheet(name);
      for (const [address, cell] of Object.entries(input)) {
        if (address.startsWith("!")) continue;
        ws.getCell(address).value = cell.v;
      }
      for (const m of input["!merges"] || [])
        ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
    }
    return wb;
  },
};
