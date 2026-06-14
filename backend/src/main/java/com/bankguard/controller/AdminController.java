package com.bankguard.controller;

import com.bankguard.service.DatabaseService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    @Autowired
    private DatabaseService databaseService;

    @GetMapping("/stats")
    public ResponseEntity<?> getStats() {
        try {
            Map<String, Object> stats = databaseService.getAdminStats();
            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/transactions")
    public ResponseEntity<?> getTransactions(@RequestParam(value = "limit", defaultValue = "50") int limit) {
        try {
            List<Map<String, Object>> txs = databaseService.getGlobalTransactionHistory(limit);
            return ResponseEntity.ok(txs);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/transactions/{id}")
    public ResponseEntity<?> deleteTransaction(@PathVariable("id") String id) {
        try {
            boolean success = databaseService.deleteTransaction(id);
            if (success) {
                return ResponseEntity.ok(Map.of("message", "Transaction deleted successfully"));
            } else {
                return ResponseEntity.status(404).body(Map.of("error", "Transaction not found"));
            }
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/streaming/status")
    public ResponseEntity<?> getStreamingStatus() {
        return ResponseEntity.ok(Map.of("enabled", databaseService.isStreamingEnabled()));
    }

    @PostMapping("/streaming/toggle")
    public ResponseEntity<?> toggleStreaming() {
        boolean status = databaseService.toggleStreaming();
        return ResponseEntity.ok(Map.of("enabled", status, "message", 
            status ? "Streaming activated" : "Streaming stopped"));
    }
    
    @PostMapping("/streaming/stop")
    public ResponseEntity<?> stopStreaming() {
        databaseService.setStreaming(false);
        return ResponseEntity.ok(Map.of("enabled", false, "message", "Streaming force stopped"));
    }
    
    @PostMapping("/streaming/start")
    public ResponseEntity<?> startStreaming() {
        databaseService.setStreaming(true);
        return ResponseEntity.ok(Map.of("enabled", true, "message", "Streaming force started"));
    }
}
