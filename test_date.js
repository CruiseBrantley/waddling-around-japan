export function testParseSheetDate(dateStr) {
    let cleanDateStr = dateStr;
    
    // Check if there's any non-digit character before the first digit.
    // If so, we can extract just the part containing digits and slashes/dashes.
    const match = dateStr.match(/\d/);
    if (match) {
        cleanDateStr = dateStr.substring(match.index);
    }

    // Now cleanDateStr starts with a digit. E.g. "28/05/2026" or "2026-05-28"
    
    // Handle YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(cleanDateStr)) {
      const [y, m, d] = cleanDateStr.split('T')[0].split('-').map(s => parseInt(s, 10));
      return new Date(y, m - 1, d);
    }
    // Handle DD/MM/YYYY or D/M/YYYY
    const parts = cleanDateStr.split('/');
    if (parts.length >= 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      // Year might have trailing characters, so parse it
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
    return new Date(dateStr);
}

console.log(testParseSheetDate("Thu, 28/05/2026"));
console.log(testParseSheetDate("Thursday 28/05/2026"));
console.log(testParseSheetDate("28/05/2026"));
console.log(testParseSheetDate("2026-05-28"));
