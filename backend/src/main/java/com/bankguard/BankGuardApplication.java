package com.bankguard;
 
import com.bankguard.service.DatabaseService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.security.crypto.password.PasswordEncoder;
 
@SpringBootApplication
public class BankGuardApplication {
    public static void main(String[] args) {
        SpringApplication.run(BankGuardApplication.class, args);
    }
 
    @Bean
    public CommandLineRunner initDb(DatabaseService databaseService, PasswordEncoder passwordEncoder) {
        return args -> {
            databaseService.initDatabase();
            
            // Auto-create default admin user if not exists
            String adminUsername = "admin@bankguard.com";
            if (databaseService.findUserByUsername(adminUsername) == null) {
                String hashedPassword = passwordEncoder.encode("Password123!");
                databaseService.createUser(
                    adminUsername,
                    hashedPassword,
                    "System Administrator",
                    40,
                    adminUsername,
                    "+33 1 00 00 00 00",
                    "BankGuard Paris Office",
                    "0000000000000000",
                    "ADMIN"
                );
                System.out.println("✅ Default admin user 'admin@bankguard.com' initialized successfully.");
            }
        };
    }
}
