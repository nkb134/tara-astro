export default {
  // Onboarding - Step 1: Welcome
  welcome: `Namaste! 🙏 I'm Tara — your personal Jyotish companion.

What can I help you with? 😊
- Career & finances
- Marriage & relationships
- General birth chart reading
- Or ask me anything!`,

  // Onboarding - Step 2: Acknowledge intent, ask name
  ask_name_career: `You want to know about your career — wonderful! I'd love to help 🌟

First, what's your name? 😊`,

  ask_name_marriage: `You want to explore relationships — I understand! I'd love to help 💫

First, what's your name? 😊`,

  ask_name_general: `You want a birth chart reading — wonderful! I'd love to help 🌟

First, what's your name? 😊`,

  ask_name_default: `I'd love to help you with that! 🌟

First, what's your name? 😊`,

  // Onboarding - Step 3: Greet by name, ask DOB
  greet_name_ask_dob: `{name}, what a lovely name! 🌟

To read your birth chart, I need your date of birth.
(Write it any way — like 15 March 1990, or 15/03/1990)`,

  // Onboarding - Step 4: Ask time
  ask_time: `Thank you! 🙏 Now, what time were you born?

(For example: 2:30 PM, morning 6, evening 5:30)

If you don't know, just say "don't know" — that's perfectly fine! 😊`,

  // Onboarding - Step 5: Ask place
  ask_place: `Almost done! 🎉

Last one — which city/town were you born in?
(For example: Chennai, Mumbai, Delhi, Kolkata)`,

  // Onboarding errors
  invalid_date: `I couldn't understand that date — could you try again? 🙏
(Write it like 15 March 1990 or 15/03/1990)`,

  invalid_time: `I couldn't understand that time — could you try again? 🙏
(Like 2:30 PM, morning 6, or just say "don't know")`,

  // Chart generation
  generating_chart: `{name}, I'm preparing your birth chart... just a moment 🔮`,

  geocode_failed: `I couldn't find that place 🙏 Could you try a bigger city name? (e.g., Chennai, Mumbai, Delhi)`,

  chart_failed: `I had trouble calculating your chart — please try again in a few minutes 🙏`,

  chart_overview: `{name}, your birth chart is ready! 🌟

☀️ Sun Sign: {sunSign}
🌙 Moon Sign: {moonSign}
⬆️ Ascendant (Lagna): {ascendant}
⭐ Nakshatra: {nakshatra}

{notable}

There's so much more to explore! What would you like to know about?
- Career & finances
- Marriage & relationships
- Remedies
- Or ask me anything!`,

  notable_exalted: `Your {planet} is exalted in {sign} — this is a very auspicious placement!`,
  notable_vargottama: `Your {planet} is Vargottama — same sign in both Rasi and Navamsha. A very powerful position!`,
  notable_strong: `Your {planet} is at {power}% strength — a wonderfully strong placement!`,
  notable_default: `Your chart has some fascinating patterns — let's explore them together!`,

  // Phase 1 echo
  echo_reply: `{name}, you said: "{message}"

(Still in testing mode — full features coming very soon! 🌟)`,
};
