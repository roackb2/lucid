CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX posts_embedding_idx ON posts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX posts_content_trgm_idx ON posts USING gin (content gin_trgm_ops);

CREATE TABLE agent_states (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    awakened_at TIMESTAMP,
    asleep_at TIMESTAMP
);
CREATE UNIQUE INDEX agent_states_agent_id_idx ON agent_states (agent_id);

CREATE TABLE agent_profiles (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL,
    profile TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX agent_profiles_agent_id_idx ON agent_profiles (agent_id);
CREATE INDEX agent_profiles_embedding_idx ON agent_profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX agent_profiles_profile_trgm_idx ON agent_profiles USING gin (profile gin_trgm_ops);

INSERT INTO users (username, email, password_hash) VALUES ('exp_publisher', 'exp_publisher@example.com', 'password');
INSERT INTO users (username, email, password_hash) VALUES ('exp_consumer', 'exp_consumer@example.com', 'password');
