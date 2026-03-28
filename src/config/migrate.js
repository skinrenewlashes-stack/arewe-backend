const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        is_verified BOOLEAN DEFAULT FALSE,
        is_18_confirmed BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        is_blocked BOOLEAN DEFAULT FALSE,
        refresh_token TEXT,
        push_token TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        notification_new_match BOOLEAN DEFAULT TRUE,
        notification_connection_request BOOLEAN DEFAULT TRUE,
        notification_payment_required BOOLEAN DEFAULT TRUE,
        notification_request_accepted BOOLEAN DEFAULT TRUE,
        notification_request_declined BOOLEAN DEFAULT TRUE,
        notification_request_expired BOOLEAN DEFAULT TRUE,
        notification_contact_exchange BOOLEAN DEFAULT TRUE,
        email_notifications BOOLEAN DEFAULT TRUE,
        push_notifications BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS email_verification_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        age_range VARCHAR(20) NOT NULL,
        city VARCHAR(100) NOT NULL,
        state_province VARCHAR(100) NOT NULL,
        race VARCHAR(50) NOT NULL,
        industry VARCHAR(100),
        car_model VARCHAR(100),
        lifestyle_habits TEXT[],
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS matches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        submission_a_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
        submission_b_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
        user_a_id UUID REFERENCES users(id) ON DELETE CASCADE,
        user_b_id UUID REFERENCES users(id) ON DELETE CASCADE,
        percentage INTEGER NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
        tier VARCHAR(20) NOT NULL CHECK (tier IN ('low','moderate','high')),
        breakdown JSONB NOT NULL DEFAULT '{}',
        user_a_unlocked BOOLEAN DEFAULT FALSE,
        user_b_unlocked BOOLEAN DEFAULT FALSE,
        user_a_unlocked_at TIMESTAMP,
        user_b_unlocked_at TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(submission_a_id, submission_b_id)
      );

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
        stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
        stripe_client_secret TEXT,
        amount_cents INTEGER NOT NULL DEFAULT 499,
        currency VARCHAR(10) NOT NULL DEFAULT 'usd',
        status VARCHAR(30) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','processing','succeeded','failed','refunded')),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, match_id)
      );

      CREATE TABLE IF NOT EXISTS connection_requests (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
        requester_id UUID REFERENCES users(id) ON DELETE CASCADE,
        recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(30) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','payment_required','accepted','declined','expired')),
        expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
        requester_shared JSONB,
        recipient_shared JSONB,
        exchange_completed BOOLEAN DEFAULT FALSE,
        exchange_completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS blocked_users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        blocker_id UUID REFERENCES users(id) ON DELETE CASCADE,
        blocked_id UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(blocker_id, blocked_id)
      );

      CREATE TABLE IF NOT EXISTS reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        reporter_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        reason VARCHAR(100) NOT NULL,
        additional_info TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_active ON submissions(is_active);
      CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a_id);
      CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b_id);
      CREATE INDEX IF NOT EXISTS idx_payments_user_match ON payments(user_id, match_id);
      CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(stripe_payment_intent_id);
      CREATE INDEX IF NOT EXISTS idx_connections_requester ON connection_requests(requester_id);
      CREATE INDEX IF NOT EXISTS idx_connections_recipient ON connection_requests(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_connections_match ON connection_requests(match_id);
      CREATE INDEX IF NOT EXISTS idx_connections_status ON connection_requests(status);
    `);
    await client.query('COMMIT');
    console.log('✅ Full schema migrated successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

module.exports = { migrate };
