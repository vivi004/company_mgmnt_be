USE company_management;

-- Modify order_line_requests table
ALTER TABLE order_line_requests DROP FOREIGN KEY order_line_requests_ibfk_2;
ALTER TABLE order_line_requests ADD CONSTRAINT order_line_requests_ibfk_2 FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE;

-- Modify requests table
ALTER TABLE requests DROP FOREIGN KEY requests_ibfk_1;
ALTER TABLE requests ADD CONSTRAINT requests_ibfk_1 FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE;
