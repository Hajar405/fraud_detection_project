package com.bankguard;

import com.bankguard.service.DatabaseService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

@SpringBootApplication
public class BankGuardApplication {
    public static void main(String[] args) {
        SpringApplication.run(BankGuardApplication.class, args);
    }

    @Bean
    public CommandLineRunner initDb(DatabaseService databaseService) {
        return args -> {
            databaseService.initDatabase();
        };
    }
}
