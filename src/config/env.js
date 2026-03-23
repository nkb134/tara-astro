import dotenv from 'dotenv';
dotenv.config();

const required = [
  'WHATSAPP_API_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'META_APP_SECRET',
  'WEBHOOK_VERIFY_TOKEN',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  whatsapp: {
    apiToken: process.env.WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.WEBHOOK_VERIFY_TOKEN,
    appSecret: process.env.META_APP_SECRET,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    indexName: process.env.PINECONE_INDEX_NAME,
  },
  geocoding: {
    apiKey: process.env.GEOCODING_API_KEY,
    geonamesUsername: process.env.GEONAMES_USERNAME,
  },
  db: {
    url: process.env.DATABASE_URL,
  },
  app: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    botName: process.env.BOT_NAME || 'Tara',
    freeTrialMinutes: parseInt(process.env.FREE_TRIAL_MINUTES || '15', 10),
  },
};
