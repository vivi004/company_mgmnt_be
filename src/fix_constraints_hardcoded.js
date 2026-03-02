const mysql = require('mysql2/promise');

async function run() {
    try {
        const connection = await mysql.createConnection({
            host: "localhost",
            user: "root",
            password: "Vivin@2004",
            database: "company_management"
        });

        console.log("Connected.");

        try {
            await connection.query('ALTER TABLE `order_line_requests` DROP FOREIGN KEY `order_line_requests_ibfk_2`');
            console.log("Dropped old fk on order_line_requests");
        } catch (e) { console.log(e.message); }

        await connection.query('ALTER TABLE `order_line_requests` ADD CONSTRAINT `order_line_requests_ibfk_2` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE');
        console.log("Added new fk on order_line_requests");

        try {
            // Drop employee_id FK from requests table as well (assuming it's requests_ibfk_1)
            await connection.query('ALTER TABLE `requests` DROP FOREIGN KEY `requests_ibfk_1`');
            console.log("Dropped old fk on requests");
        } catch (e) { console.log(e.message); }

        await connection.query('ALTER TABLE `requests` ADD CONSTRAINT `requests_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE');
        console.log("Added new fk on requests");

        console.log("Success!");
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        process.exit();
    }
}

run();
