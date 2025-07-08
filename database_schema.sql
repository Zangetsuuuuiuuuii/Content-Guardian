-- Content Guardian Database Schema

-- Users table (both guardians and regular users)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('guardian', 'user')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    verified_email BOOLEAN NOT NULL DEFAULT FALSE,
    gmail_account VARCHAR(255),
    verification_token VARCHAR(255)
);

-- Guardian-User relationships
CREATE TABLE guardian_user_links (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL REFERENCES users(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(guardian_id, user_id)
);

-- Access keys for content blocking
CREATE TABLE access_keys (
    id SERIAL PRIMARY KEY,
    key_value VARCHAR(20) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    guardian_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL, -- 'hate', 'violence', 'nsfw', etc.
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Supervision sessions
CREATE TABLE supervision_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    guardian_id INTEGER NOT NULL REFERENCES users(id),
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    key_id INTEGER REFERENCES access_keys(id)
);

-- Blocked content logs
CREATE TABLE content_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT NOT NULL,
    content_type VARCHAR(50) NOT NULL, -- 'hate', 'violence', 'nsfw', etc.
    blocked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    supervision_granted BOOLEAN NOT NULL DEFAULT FALSE,
    key_id INTEGER REFERENCES access_keys(id)
);

-- User sessions (for JWT refresh tokens)
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    refresh_token VARCHAR(255) NOT NULL,
    user_agent TEXT,
    ip_address VARCHAR(45),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_guardian_user_links_guardian_id ON guardian_user_links(guardian_id);
CREATE INDEX idx_guardian_user_links_user_id ON guardian_user_links(user_id);
CREATE INDEX idx_access_keys_user_id ON access_keys(user_id);
CREATE INDEX idx_access_keys_guardian_id ON access_keys(guardian_id);
CREATE INDEX idx_supervision_sessions_user_id ON supervision_sessions(user_id);
CREATE INDEX idx_supervision_sessions_guardian_id ON supervision_sessions(guardian_id);
CREATE INDEX idx_content_logs_user_id ON content_logs(user_id);

-- Extension status monitoring
CREATE TABLE extension_status (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    installed BOOLEAN NOT NULL DEFAULT FALSE,
    installed_at TIMESTAMP,
    uninstalled_at TIMESTAMP,
    version VARCHAR(50),
    last_heartbeat TIMESTAMP,
    installation_id VARCHAR(50),
    device_email VARCHAR(255),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    device_name VARCHAR(255),
    device_id VARCHAR(255),
    UNIQUE(user_id)
);

-- Alert management
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    guardian_id INTEGER NOT NULL REFERENCES users(id),
    alert_type VARCHAR(50) NOT NULL, -- 'content_blocked', 'extension_uninstalled', 'supervision_needed'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    content TEXT,
    url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    content_log_id INTEGER REFERENCES content_logs(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved')),
    device_email VARCHAR(255),
    device_verified BOOLEAN NOT NULL DEFAULT FALSE
);

-- Alert notification preferences
CREATE TABLE alert_preferences (
    id SERIAL PRIMARY KEY,
    guardian_id INTEGER NOT NULL REFERENCES users(id),
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    minimum_severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (minimum_severity IN ('low', 'medium', 'high', 'critical')),
    contact_phone VARCHAR(20),
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Alert delivery logs
CREATE TABLE alert_delivery_logs (
    id SERIAL PRIMARY KEY,
    alert_id INTEGER NOT NULL REFERENCES alerts(id),
    delivery_method VARCHAR(20) NOT NULL CHECK (delivery_method IN ('websocket', 'push', 'email', 'sms')),
    delivered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT
);

-- Extension heartbeat logs
CREATE TABLE extension_heartbeats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    url TEXT,
    browser_info TEXT,
    ip_address VARCHAR(45)
);

-- Create indexes for the new tables
CREATE INDEX idx_extension_status_user_id ON extension_status(user_id);
CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_guardian_id ON alerts(guardian_id);
CREATE INDEX idx_alerts_created_at ON alerts(created_at);
CREATE INDEX idx_alert_preferences_guardian_id ON alert_preferences(guardian_id);
CREATE INDEX idx_alert_delivery_logs_alert_id ON alert_delivery_logs(alert_id);
CREATE INDEX idx_extension_heartbeats_user_id ON extension_heartbeats(user_id);
CREATE INDEX idx_extension_heartbeats_received_at ON extension_heartbeats(received_at); 