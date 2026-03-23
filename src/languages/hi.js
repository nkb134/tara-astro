export default {
  // Onboarding — natural flow, combines steps
  welcome: `Namaste 🙏 Main Tara hoon. Haan bilkul madad kar sakti hoon — apna naam aur janam tithi bata do?`,

  ask_name_career: `Achha career ke baare mein? Bilkul — apna naam aur janam tithi bata do?`,
  ask_name_marriage: `Shaadi ke baare mein? Haan zaroor — apna naam aur janam tithi bata do?`,
  ask_name_general: `Haan kundli dekh deti hoon — apna naam aur janam tithi bata do?`,
  ask_name_default: `Haan zaroor — apna naam aur janam tithi bata do?`,

  // If user gave only name
  ask_dob_after_name: `{name} ji — janam tithi bata dijiye?`,

  // If user gave name + DOB together
  ask_time_after_name_dob: `{name} ji 😊 aur janam ka samay pata hai? Nahi toh koi baat nahi`,

  // After DOB (if separate)
  ask_time: `Ok... aur janam ka samay pata hai? Nahi bhi pata toh chalega`,

  // After time
  ask_place: `Achha. Aur kahan paida hue the? City bata do`,

  // After time + place together → skip place step
  // (handled in code)

  invalid_date: `Hmm yeh date samajh nahi aayi... 15/03/1990 ya 15 March 1990 jaisa likh do`,
  invalid_time: `Hmm yeh samay samajh nahi aaya... 2:30 PM jaisa likh do, ya "pata nahi" bol do`,

  generating_chart: `Hmm... kundli dekh rahi hoon ek minute`,
  geocode_failed: `Hmm yeh jagah nahi mili... koi paas ka bada shehar batao?`,
  chart_failed: `Kundli mein thodi dikkat aa rahi hai... thodi der baad try karo 🙏`,

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

  hook_frame: `Kundli dekhi... ek baat hai jo mujhe bahut interesting lagi.\n\n`,
  hook_suffix: `\n\nYeh sahi hai?`,
  thinking_phrases: ['Hmm...', 'Dekho...', 'Ek minute...', 'Achha toh...', 'Suno...'],
};
