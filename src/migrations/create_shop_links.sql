-- Migration: Create shop_links table for route linking duplicate shops
CREATE TABLE IF NOT EXISTS shop_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    primary_shop_id INT NOT NULL,
    linked_shop_id INT NOT NULL,
    linked_by VARCHAR(100),
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    note VARCHAR(255) DEFAULT '',
    UNIQUE KEY uq_linked_shop (linked_shop_id),
    FOREIGN KEY (primary_shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_shop_id) REFERENCES shops(id) ON DELETE CASCADE
);
