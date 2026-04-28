const fs = require('fs');
const key = 'AIzaSyACMhIUoyNsXq4zewCNdUn7-RUQiiSyEpQ';
const id = '1yrO4hi5uNCTS7HIgMX817B44je1dFfaVpGjdDsBgwWg';
const range = 'Itinerary'; // Try 'Itinerary' since the other one failed
const url = `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true&ranges=${encodeURIComponent(range)}&key=${key}`;
fetch(url).then(r => r.json()).then(d => {
  fs.writeFileSync('sheet_data.json', JSON.stringify(d, null, 2));
  console.log('Saved to sheet_data.json');
}).catch(console.error);
