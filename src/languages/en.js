export default {
  welcome_greeting: `Namaste 🙏 I'm Tara — Vedic and Nadi Jyotish. How are you today? What can I help with?`,

  welcome: `Namaste 🙏 I'm Tara. Sure — I'll look at your chart and see what the stars say. Share your name and date of birth?`,

  ask_name_career: `Namaste 🙏 I'm Tara. Career guidance, sure — share your name and date of birth? Then we'll look at your chart together`,
  ask_name_marriage: `Namaste 🙏 I'm Tara. Marriage guidance, sure — share your name and date of birth? Then we'll look at your chart together`,
  ask_name_general: `Namaste 🙏 I'm Tara. Sure, let's look at your chart — share your name and date of birth? We'll figure out the way forward together`,
  ask_name_default: `Namaste 🙏 I'm Tara. Yes absolutely — share your name and date of birth? Then we'll look at your chart together and figure out the way forward`,

  // Post-greeting topic responses (NO re-introduction)
  ask_topic_career: `Career guidance, sure — share your name and date of birth? Then we'll look at your chart together`,
  ask_topic_marriage: `Marriage guidance, sure — share your name and date of birth? Then we'll look at your chart together`,
  ask_topic_general: `Sure, let's look at your chart — share your name and date of birth?`,
  ask_topic_default: `Yes absolutely — share your name and date of birth? Then we'll look at your chart together`,

  casual_chat_response: `I'm doing good too 😊 So tell me, what would you like to know — career, relationships, or something else?`,
  ask_dob_after_name: `{name} — and your date of birth?`,
  ask_time_after_name_dob: `{name} 😊 ok. Do you know your birth time? If not, no worries — I can still tell you a lot without it`,
  ask_time: `Ok... do you know your birth time? If not, no worries — I can still tell you a lot without it`,
  ask_place: `Got it. And where were you born? Just the city name`,
  ask_place_after_unknown_time: `That's ok, I can still read a lot from your chart without the exact time. Where were you born?`,

  invalid_date: `Hmm didn't catch that date... try something like 15/03/1990 or 15 March 1990`,
  invalid_date_retry: `No worries 😊 Just type it like: 15/03/1990 or 15 March 1990`,
  invalid_date_final: `Let's keep it simple — just send DD/MM/YYYY, like 15/03/1990`,
  invalid_time: `Hmm didn't catch that time... try like 2:30 PM, or just say "don't know"`,
  invalid_time_retry: `No worries — type "10:30 AM" if you know, or "don't know" if not`,
  invalid_time_final: `That's ok — I can tell you a lot without the time. Where were you born? Just the city`,

  location_confirmed: `Ok, {place} — generating your chart based on this location`,
  generating_chart: `Give me a moment...`,
  geocode_failed: `Hmm can't find that place... what's the nearest big city?`,
  geocode_failed_2: `Sorry, still can't find it. Try a major city nearby — like the state capital`,
  chart_failed: `Hmm... one sec, let me try again`,
  chart_failed_2: `Still having trouble... try again in a minute 🙏`,

  frustration_apology: `Sorry about that — let me try again`,

  disambiguate_few: `There are a few places called {city} — {options}?`,
  disambiguate_many: `That name matches many places... which state?`,

  chart_overview: `{name}, your chart is ready 🌟

☀️ Sun Sign: {sunSign}
🌙 Moon Sign: {moonSign}
⬆️ Ascendant: {ascendant}
⭐ Nakshatra: {nakshatra}
🔄 Dasha: {dasha}

{notable}

What do you want to know — career, marriage, or something else?`,

  notable_exalted: `Your {planet} is exalted in {sign} — really strong placement`,
  notable_vargottama: `Your {planet} is Vargottama — same sign in Rasi and Navamsha. Very powerful`,
  notable_strong: `Your {planet} is at {power}% strength — solid placement`,
  notable_default: `Your chart has some interesting patterns — let's dig in`,

  echo_reply: `{name}, you said: "{message}"\n\n(Testing mode — full features coming soon 🌟)`,

  post_chart_prompt: `What would you like to know? 👇`,
  hook_frame: `I looked at your chart... something really stood out.\n\n`,
  hook_suffix: `\n\nDoes that resonate?`,
  thinking_phrases: ['Hmm...', 'One sec...'],

  generic_error: 'Hmm something went wrong on my end... try again in a minute 🙏',
};
