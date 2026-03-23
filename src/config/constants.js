export const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

export const PRICING = {
  '15min': { durationMinutes: 15, priceInr: 5100 },
  '30min': { durationMinutes: 30, priceInr: 15100 },
  '60min': { durationMinutes: 60, priceInr: 25100 },
  'unlimited_day': { durationMinutes: 1440, priceInr: 50100 },
};

export const MODELS = {
  classifier: 'gemini-2.0-flash-lite',
  simple: 'gemini-2.0-flash',
  complex: 'gemini-2.5-pro-preview-06-05',
};

export const MAX_WHATSAPP_MESSAGE_LENGTH = 4096;
