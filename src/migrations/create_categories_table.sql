CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    icon VARCHAR(50) DEFAULT '🏷️',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial categories to maintain continuity
INSERT IGNORE INTO categories (name, icon) VALUES 
('NISHA (Pure Oils)', '🏷️'),
('MIXED Oil', '🏷️'),
('PALM Oil', '🏷️'),
('Other Oil', '🏷️');
