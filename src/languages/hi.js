export default {
  // Just greeting (hi/hello/namaste) — chat first, don't ask data yet
  welcome_greeting: `Namaste 🙏 Main Tara hoon — Vedic aur Nadi Jyotish. Kaise hain aap aaj? Bataiye kisme madad karun?`,

  // Topic-specific intros — ask for data
  welcome: `Namaste 🙏 Main Tara hoon. Haan zaroor madad karungi — main kundli se dekhungi ki stars kya keh rahe hain. Bas apna naam aur janam tithi bata dijiye?`,
  ask_name_career: `Namaste 🙏 Main Tara hoon. Haan career mein zaroor madad karungi — kundli se dekhungi ki stars kya keh rahe hain. Apna naam aur janam tithi bata dijiye?`,
  ask_name_marriage: `Namaste 🙏 Main Tara hoon. Achha shaadi ke baare mein — haan zaroor madad karungi. Kundli se dekhungi. Apna naam aur janam tithi bata dijiye?`,
  ask_name_general: `Namaste 🙏 Main Tara hoon. Haan kundli dekh deti hoon — apna naam aur janam tithi bata dijiye?`,
  ask_name_default: `Namaste 🙏 Main Tara hoon. Haan zaroor madad karungi — kundli se dekhungi. Apna naam aur janam tithi bata dijiye?`,

  // Post-greeting topic responses (NO re-introduction — Tara already said who she is)
  ask_topic_career: `Haan career mein zaroor madad karungi — kundli se dekhungi. Bas apna naam aur janam tithi bata dijiye?`,
  ask_topic_marriage: `Achha shaadi ke baare mein — haan zaroor madad karungi. Kundli se dekhungi. Apna naam aur janam tithi bata dijiye?`,
  ask_topic_general: `Haan kundli dekh deti hoon — apna naam aur janam tithi bata dijiye?`,
  ask_topic_default: `Haan zaroor madad karungi — kundli se dekhungi. Apna naam aur janam tithi bata dijiye?`,

  // Casual chat during onboarding (don't rush to data collection)
  casual_chat_response: `Main bhi badhiya hoon 😊 Bataiye, kisme madad karun — career, shaadi, ya kuch aur?`,

  // Bug 7: Warm follow-ups
  ask_dob_after_name: `{name} ji — janam tithi bata dijiye?`,
  ask_time_after_name_dob: `{name} ji 😊 achha. Aur janam ka samay pata hai? Nahi pata toh koi baat nahi, bina samay ke bhi bahut kuch bata sakti hoon`,
  ask_time: `Ok... aur janam ka samay pata hai? Nahi pata toh koi baat nahi, bina samay ke bhi bahut kuch bata sakti hoon`,
  ask_place: `Achha. Aur kahan paida hue the aap? City bata dijiye`,
  ask_place_after_unknown_time: `Koi baat nahi, bina time ke bhi bahut kuch dikh jaata hai kundli mein. Kahan paida hue the?`,

  invalid_date: `Hmm yeh date samajh nahi aayi... 15/03/1990 ya 15 March 1990 jaisa likh dijiye`,
  invalid_time: `Hmm yeh samay samajh nahi aaya... 2:30 PM jaisa likh dijiye, ya "pata nahi" bol dijiye`,

  location_confirmed: `Ok, {place} — iss location ke hisaab se kundli nikal rahi hoon`,
  generating_chart: `Ek minute dijiye...`,
  geocode_failed: `Hmm yeh jagah nahi mili... koi paas ka bada shehar batao?`,
  geocode_failed_2: `Sorry, phir se nahi mila. Nearest big city ka naam batao — jaise Raipur ya Nagpur`,
  chart_failed: `Hmm... ek minute, phir try karti hoon`,
  chart_failed_2: `Is baar bhi dikkat aa rahi hai... thodi der baad try karo 🙏`,

  // Bug 6: Frustration handling
  frustration_apology: `Sorry, meri galti — phir se dekhti hoon`,

  // Disambiguation
  disambiguate_few: `{city} toh kai jagah hai — {options} wala?`,
  disambiguate_many: `Yeh naam bahut jagah hai... state bhi bata do?`,

  chart_overview: `{name}, kundli taiyaar hai 🌟

☀️ Surya rashi: {sunSign}
🌙 Chandra rashi: {moonSign}
⬆️ Lagna: {ascendant}
⭐ Nakshatra: {nakshatra}
🔄 Dasha: {dasha}

{notable}

Kya jaanna hai — career, shaadi, ya kuch aur?`,

  notable_exalted: `Tumhara {planet} {sign} mein uchcha hai — bahut achhi sthiti`,
  notable_vargottama: `Tumhara {planet} Vargottam hai — rashi aur navamsh dono mein same. Bahut strong`,
  notable_strong: `Tumhara {planet} {power}% strength pe hai — kaafi mazboot`,
  notable_default: `Kundli mein kuch interesting dikh raha hai — detail mein dekhte hain`,

  echo_reply: `{name}, aapne kaha: "{message}"\n\n(Testing chal raha hai — poore features jaldi aayenge 🌟)`,

  post_chart_prompt: `Kya jaanna chahte hain? 👇`,
  hook_frame: `Kundli dekhi... ek baat hai jo mujhe bahut interesting lagi.\n\n`,
  hook_suffix: `\n\nYeh sahi hai?`,
  thinking_phrases: ['Hmm...', 'Ek minute...'],

  generic_error: 'Ek minute... kuch gadbad ho gayi. Phir se try kijiye 🙏',
};
