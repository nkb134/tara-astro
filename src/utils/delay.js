export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function calculateDelay(messageType, responseLength = 0) {
  let baseMs;

  switch (messageType) {
    case 'greeting':
    case 'simple':
      baseMs = 2000 + Math.random() * 1000; // 2-3s
      break;
    case 'medium':
    case 'onboarding':
      baseMs = 4000 + Math.random() * 2000; // 4-6s
      break;
    case 'complex':
    case 'reading':
      baseMs = 7000 + Math.random() * 3000; // 7-10s
      break;
    default:
      baseMs = 3000 + Math.random() * 2000; // 3-5s
  }

  // Slightly longer for longer responses
  if (responseLength > 500) {
    baseMs += 1000 + Math.random() * 1000;
  }

  // Random variance +/- 1 second
  const variance = (Math.random() - 0.5) * 2000;

  return Math.max(1500, Math.round(baseMs + variance));
}
