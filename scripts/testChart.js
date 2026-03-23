import dotenv from 'dotenv';
dotenv.config();

import { geocodeBirthPlace } from '../src/jyotish/geocode.js';
import { generateBirthChart } from '../src/jyotish/vedastro.js';
import { formatChartOverview } from '../src/jyotish/chartFormatter.js';

const TEST_CASES = [
  {
    name: 'Rajinikanth (known chart)',
    place: 'Bangalore',
    date: '1950-12-12',
    time: '23:14',
    lang: 'ta',
  },
  {
    name: 'Test User - Chennai',
    place: 'Chennai',
    date: '1990-03-25',
    time: '14:30',
    lang: 'en',
  },
];

async function runTest(testCase) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testCase.name}`);
  console.log(`Place: ${testCase.place}, Date: ${testCase.date}, Time: ${testCase.time}`);
  console.log('='.repeat(60));

  // Step 1: Geocode
  console.log('\n1. Geocoding...');
  const geo = await geocodeBirthPlace(testCase.place);
  if (!geo) {
    console.error('FAILED: Geocoding returned null');
    return;
  }
  console.log(`   Place: ${geo.formattedPlace}`);
  console.log(`   Lat: ${geo.lat}, Lng: ${geo.lng}`);
  console.log(`   Timezone: ${geo.timezone}`);

  // Step 2: Generate chart
  console.log('\n2. Generating birth chart (this takes 4-5 minutes due to API rate limits)...');
  const startTime = Date.now();
  const chartData = await generateBirthChart(
    testCase.date, testCase.time, geo.lat, geo.lng, geo.timezone, geo.formattedPlace
  );
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`   Chart generated in ${elapsed} seconds`);

  // Step 3: Display results
  console.log('\n3. Chart Data:');
  console.log(`   Sun Sign: ${chartData.sunSign}`);
  console.log(`   Moon Sign: ${chartData.moonSign}`);
  console.log(`   Ascendant: ${chartData.ascendant}`);
  console.log(`   Nakshatra: ${chartData.nakshatra?.name} (Pada ${chartData.nakshatra?.pada})`);

  console.log('\n   Planetary Positions:');
  for (const [planet, data] of Object.entries(chartData.planets)) {
    if (data.error) {
      console.log(`   ${planet}: ERROR`);
      continue;
    }
    const flags = [];
    if (data.retrograde) flags.push('R');
    if (data.exalted) flags.push('Exalted');
    if (data.debilitated) flags.push('Debilitated');
    if (data.vargottama) flags.push('Vargottama');
    if (data.combust) flags.push('Combust');
    const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
    console.log(`   ${planet.padEnd(8)} → ${data.sign} (${data.house}) - ${data.constellation}${flagStr} - Power: ${Math.round(data.powerPercentage)}%`);
  }

  console.log('\n   House Signs:');
  for (const [house, data] of Object.entries(chartData.houses)) {
    const planets = data.planetsInHouse?.length ? ` ← [${data.planetsInHouse.join(', ')}]` : '';
    console.log(`   ${house.padEnd(7)} → ${data.sign} (Lord: ${data.lord})${planets}`);
  }

  // Step 4: Format overview
  console.log('\n4. Formatted Overview:');
  const overview = formatChartOverview(chartData, testCase.lang, testCase.name);
  console.log(overview);
}

// Run only the first test case (to avoid rate limiting)
const caseIndex = parseInt(process.argv[2] || '0');
const testCase = TEST_CASES[caseIndex];
if (!testCase) {
  console.error(`No test case at index ${caseIndex}. Available: 0-${TEST_CASES.length - 1}`);
  process.exit(1);
}

runTest(testCase).then(() => {
  console.log('\nDone!');
  process.exit(0);
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
