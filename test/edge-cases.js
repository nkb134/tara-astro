/**
 * Edge Case Test Suite — runs before every deploy.
 *
 * Tests the LLM parser + regex parser against real beta user inputs.
 * Evolves over time as new edge cases are discovered.
 *
 * Usage: node test/edge-cases.js
 * Exit code 0 = all pass, 1 = failures found
 */
import 'dotenv/config';
import { llmParseBirthData } from '../src/services/llmParser.js';

// ─── TEST CASES ───
// Each case: [input, step, expected_fields]
// expected_fields: { name, date, time, time_known, place } — only check fields that are set

const CASES = [
  // ═══ From Aishray Suryawanshi (beta user) ═══
  {
    name: 'Aishray: name + date DD-MM-YYYY',
    input: 'Aishray Suryawanshi\n09-03-1998',
    step: 'awaiting_name_dob',
    expect: { name: 'Aishray Suryawanshi', date: '1998-03-09' },
  },
  {
    name: 'Aishray: date correction "Sorry 09-03-1997"',
    input: 'Sorry 09-03-1997',
    step: 'awaiting_time',
    expect: { date: '1997-03-09' },
  },
  {
    name: 'Aishray: question NOT a place — "What\'s the date you took as final?"',
    input: "What's the date you took as final?",
    step: 'awaiting_place',
    expect: { place: null, name: null },
  },

  // ═══ From Atreyee Date (beta user) ═══
  {
    name: 'Atreyee: "Name: X\\nDate of birth D.M.YYYY"',
    input: 'Name: Atreyee\nDate of birth 5.7.1990',
    step: 'awaiting_name_dob',
    expect: { name: 'Atreyee', date: '1990-07-05' },
  },
  {
    name: 'Atreyee: "No I don\'t know" = unknown time',
    input: "No I don't know",
    step: 'awaiting_time',
    expect: { time_known: false },
  },

  // ═══ From Muskan Raj (beta user) ═══
  {
    name: 'Muskan: multi-line name+date+time',
    input: 'Muskan Raj\n20/11/1991\n10.20 am',
    step: 'awaiting_name_dob',
    expect: { name: 'Muskan Raj', date: '1991-11-20' },
  },
  {
    name: 'Muskan: "Try again what?" is NOT a place',
    input: 'Try again what?',
    step: 'awaiting_place',
    expect: { place: null },
  },

  // ═══ From MAXON/Saroj (beta user) ═══
  {
    name: 'Saroj: name + DD/MM/YYYY',
    input: 'SAROJ KUMAR BEHERA\n07/01/1975',
    step: 'awaiting_name_dob',
    expect: { name_contains: 'Saroj', date: '1975-01-07' },
  },
  {
    name: 'Saroj: corrected date + time "30/01/1975 2.15 am"',
    input: '30/01/1975\n2.15 am',
    step: 'awaiting_time',
    expect: { date: '1975-01-30' },
  },

  // ═══ From Kabir (beta user) ═══
  {
    name: 'Kabir: "9 am" simple time',
    input: '9 am',
    step: 'awaiting_time',
    expect: { time: '09:00' },
  },
  {
    name: 'Kabir: "5 April 1989" text date',
    input: '5 April 1989',
    step: 'awaiting_dob',
    expect: { date: '1989-04-05' },
  },

  // ═══ Hindi time expressions ═══
  {
    name: 'Hindi: "poune 11 baje raat ko" = 22:45',
    input: 'poune 11 baje raat ko',
    step: 'awaiting_time',
    expect: { time: '22:45' },
  },
  {
    name: 'Hindi: "sawa 3 baje subah" = 03:15',
    input: 'sawa 3 baje subah',
    step: 'awaiting_time',
    expect: { time: '03:15' },
  },
  {
    name: 'Hindi: "dedh baje dopahar" = 13:30',
    input: 'dedh baje dopahar',
    step: 'awaiting_time',
    expect: { time: '13:30' },
  },
  {
    name: 'Hindi: "around 10:45PM" = 22:45',
    input: 'around 10:45PM',
    step: 'awaiting_time',
    expect: { time: '22:45' },
  },

  // ═══ Combined time + place ═══
  {
    name: 'Combined: "Jagdalpur Chattisgarh around 10:45PM"',
    input: 'Jagdalpur Chattisgarh me paida hua around 10:45PM',
    step: 'awaiting_time',
    expect: { place_contains: 'Jagdalpur' },
  },

  // ═══ Unknown time variations ═══
  {
    name: 'Unknown: "pata nahi"',
    input: 'pata nahi',
    step: 'awaiting_time',
    expect: { time_known: false },
  },
  {
    name: 'Unknown: "not sure"',
    input: 'not sure',
    step: 'awaiting_time',
    expect: { time_known: false },
  },
  {
    name: 'Unknown: "nahi pata mujhe"',
    input: 'nahi pata mujhe',
    step: 'awaiting_time',
    expect: { time_known: false },
  },

  // ═══ Sentences that are NOT names ═══
  {
    name: 'Sentence: "I have quit my job" is NOT a name',
    input: 'I have quit my job and need career guidance',
    step: 'awaiting_name_dob',
    expect: { name: null, date: null },
  },
  {
    name: 'Sentence: "mujhe career me guidance chahiye" is NOT a name',
    input: 'mujhe career me guidance chahiye',
    step: 'awaiting_name_dob',
    expect: { name: null },
  },

  // ═══ Acknowledgments that are NOT data ═══
  {
    name: 'Ack: "ok" is nothing',
    input: 'ok',
    step: 'awaiting_time',
    expect: { name: null, date: null, time: null, place: null },
  },
  {
    name: 'Ack: "hain" is nothing',
    input: 'hain',
    step: 'awaiting_place',
    expect: { place: null },
  },
  {
    name: 'Ack: "achha theek hai" is nothing',
    input: 'achha theek hai',
    step: 'awaiting_time',
    expect: { name: null, date: null },
  },

  // ═══ Place edge cases ═══
  {
    name: 'Place: "Ghaziabad" simple city',
    input: 'Ghaziabad',
    step: 'awaiting_place',
    expect: { place_contains: 'Ghaziabad' },
  },
  {
    name: 'Place: "Bhubaneswar, Odisha" city+state',
    input: 'Bhubaneswar, Odisha',
    step: 'awaiting_place',
    expect: { place_contains: 'Bhubaneswar' },
  },
  {
    name: 'Place: "Delhi" should NOT become "Delhi, Delhi"',
    input: 'Delhi',
    step: 'awaiting_place',
    expect: { place_contains: 'Delhi' },
  },

  // ═══ From Nissar/Rampur (beta user) ═══
  {
    name: 'Nissar: "nhi up nhi" is NOT a place — its a correction/denial',
    input: 'nhi up nhi',
    step: 'awaiting_place',
    expect: { place: null },
  },
  {
    name: 'Nissar: "nepal, palpa district" international place',
    input: 'nepal, palpa district',
    step: 'awaiting_place',
    expect: { place_contains: 'palpa' },
  },
  {
    name: 'Nissar: "wait mere birth time galat bata diya" is NOT data',
    input: 'wait mere birth time galat bata diya',
    step: 'awaiting_place',
    expect: { place: null, name: null },
  },
  {
    name: 'Nissar: "woh 10:45AM hai" time correction',
    input: 'woh 10:45AM hai',
    step: 'awaiting_time',
    expect: { time: '10:45' },
  },
  {
    name: 'Nissar: "thoda details toh dijiye general overview" merged rapid messages',
    input: 'thoda details toh dijiye\ngeneral overview toh dijiye\nyeh kya h',
    step: 'awaiting_place',
    expect: { place: null, name: null },
  },

  // ═══ International places ═══
  {
    name: 'International: "Kathmandu, Nepal"',
    input: 'Kathmandu, Nepal',
    step: 'awaiting_place',
    expect: { place_contains: 'Kathmandu' },
  },
  {
    name: 'International: "Dubai"',
    input: 'Dubai',
    step: 'awaiting_place',
    expect: { place_contains: 'Dubai' },
  },

  // ═══ Denial/correction phrases that are NOT places ═══
  {
    name: 'Denial: "nahi yeh nahi hai"',
    input: 'nahi yeh nahi hai',
    step: 'awaiting_place',
    expect: { place: null },
  },
  {
    name: 'Denial: "no thats wrong"',
    input: 'no thats wrong',
    step: 'awaiting_place',
    expect: { place: null },
  },
  {
    name: 'Denial: "galat hai yeh"',
    input: 'galat hai yeh',
    step: 'awaiting_place',
    expect: { place: null },
  },

  // ═══ Date format variations ═══
  {
    name: 'Date: DD/MM/YYYY',
    input: '15/03/1990',
    step: 'awaiting_dob',
    expect: { date: '1990-03-15' },
  },
  {
    name: 'Date: D.M.YYYY (dots, single digits)',
    input: '5.7.1990',
    step: 'awaiting_dob',
    expect: { date: '1990-07-05' },
  },
  {
    name: 'Date: "10th June 1990" with ordinal',
    input: '10th June 1990',
    step: 'awaiting_dob',
    expect: { date: '1990-06-10' },
  },
  {
    name: 'Date: "March 15, 1990" US format',
    input: 'March 15, 1990',
    step: 'awaiting_dob',
    expect: { date: '1990-03-15' },
  },
];

// ─── Test runner ───

async function runTests() {
  console.log(`\n🧪 Running ${CASES.length} edge case tests...\n`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const tc of CASES) {
    try {
      const result = await llmParseBirthData(tc.input, tc.step);
      const errors = validateResult(result, tc.expect);

      if (errors.length === 0) {
        passed++;
        console.log(`  ✅ ${tc.name}`);
      } else {
        failed++;
        failures.push({ name: tc.name, errors, result });
        console.log(`  ❌ ${tc.name}`);
        for (const err of errors) {
          console.log(`     ${err}`);
        }
      }
    } catch (err) {
      failed++;
      failures.push({ name: tc.name, errors: [err.message] });
      console.log(`  💥 ${tc.name}: ${err.message}`);
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${passed}/${CASES.length} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.errors.join(', ')}`);
      if (f.result) console.log(`    Got: ${JSON.stringify(f.result)}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

function validateResult(result, expect) {
  const errors = [];

  if ('name' in expect) {
    if (expect.name === null && result.name !== null) {
      errors.push(`name: expected null, got "${result.name}"`);
    } else if (expect.name !== null && result.name !== expect.name) {
      errors.push(`name: expected "${expect.name}", got "${result.name}"`);
    }
  }

  if ('name_contains' in expect) {
    if (!result.name || !result.name.toLowerCase().includes(expect.name_contains.toLowerCase())) {
      errors.push(`name: expected to contain "${expect.name_contains}", got "${result.name}"`);
    }
  }

  if ('date' in expect) {
    if (expect.date === null && result.date !== null) {
      errors.push(`date: expected null, got "${result.date}"`);
    } else if (expect.date !== null && result.date !== expect.date) {
      errors.push(`date: expected "${expect.date}", got "${result.date}"`);
    }
  }

  if ('time' in expect) {
    if (expect.time === null && result.time !== null) {
      errors.push(`time: expected null, got ${JSON.stringify(result.time)}`);
    } else if (expect.time !== null) {
      const gotTime = result.time?.time?.substring(0, 5) || null;
      if (gotTime !== expect.time) {
        errors.push(`time: expected "${expect.time}", got "${gotTime}"`);
      }
    }
  }

  if ('time_known' in expect) {
    const gotKnown = result.time?.known;
    if (gotKnown !== expect.time_known) {
      errors.push(`time_known: expected ${expect.time_known}, got ${gotKnown}`);
    }
  }

  if ('place' in expect) {
    if (expect.place === null && result.place !== null) {
      errors.push(`place: expected null, got "${result.place}"`);
    } else if (expect.place !== null && result.place !== expect.place) {
      errors.push(`place: expected "${expect.place}", got "${result.place}"`);
    }
  }

  if ('place_contains' in expect) {
    const placeLower = (result.place || '').toLowerCase();
    if (!placeLower.includes(expect.place_contains.toLowerCase())) {
      errors.push(`place: expected to contain "${expect.place_contains}", got "${result.place}"`);
    }
  }

  return errors;
}

runTests();
