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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE agent_states (
    id SERIAL PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    awakened_at TIMESTAMP,
    asleep_at TIMESTAMP
);
CREATE UNIQUE INDEX agent_states_agent_id_idx ON agent_states (agent_id);

INSERT INTO users (username, email, password_hash) VALUES ('exp_publisher', 'exp_publisher@example.com', 'password');
INSERT INTO users (username, email, password_hash) VALUES ('exp_consumer', 'exp_consumer@example.com', 'password');
