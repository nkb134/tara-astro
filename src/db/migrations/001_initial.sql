-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    whatsapp_id VARCHAR(20) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    language VARCHAR(10) DEFAULT 'ta',
    created_at TIMESTAMP DEFAULT NOW(),
    last_active_at TIMESTAMP DEFAULT NOW(),

    -- Onboarding status
    onboarding_step VARCHAR(30) DEFAULT 'new',
    is_onboarded BOOLEAN DEFAULT FALSE,

    -- User profile
    gender VARCHAR(10),

    -- Birth data
    birth_date DATE,
    birth_time TIME,
    birth_time_known BOOLEAN DEFAULT TRUE,
    birth_place VARCHAR(200),
    birth_lat DECIMAL(10,7),
    birth_lng DECIMAL(10,7),
    birth_timezone VARCHAR(50),

    -- Pre-calculated chart data (from VedAstro)
    chart_data JSONB,
    chart_summary TEXT,

    -- Payment & subscription
    total_spent_inr INTEGER DEFAULT 0,
    is_first_session_used BOOLEAN DEFAULT FALSE,
    referral_code VARCHAR(20),
    referred_by INTEGER REFERENCES users(id),

    preferences JSONB DEFAULT '{}'::jsonb
);

-- Paid sessions
CREATE TABLE IF NOT EXISTS paid_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    razorpay_payment_id VARCHAR(100),
    razorpay_order_id VARCHAR(100),

    session_type VARCHAR(20) NOT NULL,
    duration_minutes INTEGER NOT NULL,
    price_inr INTEGER NOT NULL,

    status VARCHAR(20) DEFAULT 'pending',
    payment_status VARCHAR(20) DEFAULT 'unpaid',
    started_at TIMESTAMP,
    expires_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    session_id INTEGER REFERENCES paid_sessions(id),
    started_at TIMESTAMP DEFAULT NOW(),
    last_message_at TIMESTAMP DEFAULT NOW(),
    topic VARCHAR(50),
    topic_summary TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    message_count INTEGER DEFAULT 0
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER REFERENCES conversations(id),
    user_id INTEGER REFERENCES users(id),
    role VARCHAR(10) NOT NULL,
    content TEXT NOT NULL,
    language VARCHAR(10),
    intent VARCHAR(30),
    model_used VARCHAR(50),
    rag_sources JSONB,
    chart_context_used BOOLEAN DEFAULT FALSE,
    response_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_paid_sessions_user ON paid_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_paid_sessions_status ON paid_sessions(status);
CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp_id);
