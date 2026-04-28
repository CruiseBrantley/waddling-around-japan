const key = 'AIzaSyACMhIUoyNsXq4zewCNdUn7-RUQiiSyEpQ';
const id = '1yrO4hi5uNCTS7HIgMX817B44je1dFfaVpGjdDsBgwWg';
const range = 'dY\`\" Itinerary';
const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(range)}&key=${key}`;
fetch(url).then(r => r.json()).then(d => {
  const rowData = d.sheets?.[0]?.data?.[0]?.rowData;
  if (!rowData) { console.log('no rowData', d); return; }
  const dates = [];
  rowData.slice(4, 30).forEach(row => {
    const val = row.values?.[0]?.formattedValue;
    if (val) dates.push(val);
  });
  console.log(dates);
}).catch(console.error);
