package com.bankguard.controller;

import com.bankguard.security.JwtUtil;
import com.bankguard.service.DatabaseService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private DatabaseService databaseService;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtUtil jwtUtil;

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody Map<String, Object> payload) {
        try {
            String username = (String) payload.get("username");
            String password = (String) payload.get("password");
            String fullName = (String) payload.get("fullName");
            int age = Integer.parseInt(payload.getOrDefault("age", "30").toString());
            String gender = (String) payload.getOrDefault("gender", "M");
            String dob = (String) payload.getOrDefault("dob", "1990-01-01");
            String email = (String) payload.get("email");
            String phone = (String) payload.get("phone");
            String address = (String) payload.get("address");
            String cardNumber = (String) payload.get("cardNumber");
            String role = (String) payload.getOrDefault("role", "USER");

            if (username == null || password == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Username and password are required"));
            }

            // Encrypt password
            String hashedPassword = passwordEncoder.encode(password);

            boolean success = databaseService.createUser(
                username, hashedPassword, fullName, age, gender, dob, email, phone, address, cardNumber, role
            );

            if (success) {
                return ResponseEntity.ok(Map.of("message", "User registered successfully"));
            } else {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("error", "Failed to register user. Username might already exist."));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> payload) {
        String username = payload.get("username");
        String password = payload.get("password");

        if (username == null || password == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Username and password are required"));
        }

        Map<String, Object> user = databaseService.findUserByUsername(username);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Invalid username or password"));
        }

        String hashedPassword = (String) user.get("password");
        if (passwordEncoder.matches(password, hashedPassword)) {
            String role = (String) user.get("role");
            String token = jwtUtil.generateToken(username, role);
            
            return ResponseEntity.ok(Map.of(
                "token", token,
                "username", username,
                "role", role,
                "ccNum", user.get("ccNum")
            ));
        } else {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Invalid username or password"));
        }
    }

    @GetMapping("/me")
    public ResponseEntity<?> getMe() {
        try {
            String username = SecurityContextHolder.getContext().getAuthentication().getName();
            Map<String, Object> profile = databaseService.findUserProfile(username);
            if (profile != null) {
                return ResponseEntity.ok(profile);
            } else {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "User not found"));
            }
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
