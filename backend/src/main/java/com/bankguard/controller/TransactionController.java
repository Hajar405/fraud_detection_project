package com.bankguard.controller;

import com.bankguard.service.DatabaseService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.*;

@RestController
@RequestMapping("/api/transactions")
public class TransactionController {

    @Autowired
    private DatabaseService databaseService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Value("${ml.sidecar.url:http://localhost:5000/predict}")
    private String mlSidecarUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @PostMapping("/analyze")
    public ResponseEntity<?> analyzeTransaction(@RequestBody Map<String, Object> transaction) {
        try {
            // Extract raw fields
            String merchant = (String) transaction.getOrDefault("merchant", "unknown_merchant");
            String category = (String) transaction.getOrDefault("category", "unknown_category");
            String gender = (String) transaction.getOrDefault("gender", "M");
            String city = (String) transaction.getOrDefault("city", "unknown_city");
            String state = (String) transaction.getOrDefault("state", "unknown_state");
            int cityPop = Integer.parseInt(transaction.getOrDefault("city_pop", "1000").toString());
            String job = (String) transaction.getOrDefault("job", "unknown_job");
            String dob = (String) transaction.getOrDefault("dob", "1990-01-01");
            double lat = Double.parseDouble(transaction.getOrDefault("lat", "0.0").toString());
            double lon = Double.parseDouble(transaction.getOrDefault("long", "0.0").toString());
            double merchLat = Double.parseDouble(transaction.getOrDefault("merch_lat", "0.0").toString());
            double merchLon = Double.parseDouble(transaction.getOrDefault("merch_long", "0.0").toString());
            double amt = Double.parseDouble(transaction.getOrDefault("amt", "0.0").toString());
            String ccNum = (String) transaction.getOrDefault("cc_num", "unknown_card");
            
            // Format dates
            String transDate = (String) transaction.getOrDefault("trans_date", new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
            String transId = (String) transaction.getOrDefault("trans_id", UUID.randomUUID().toString());

            // 1. Forward raw transaction details to Flask ML Sidecar
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            Map<String, Object> requestBody = new HashMap<>(transaction);
            requestBody.put("trans_date", transDate);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);
            
            Map<String, Object> prediction = null;
            try {
                ResponseEntity<Map> response = restTemplate.postForEntity(mlSidecarUrl, entity, Map.class);
                prediction = response.getBody();
            } catch (Exception e) {
                System.err.println("⚠️ Warning: Flask ML sidecar unreachable at " + mlSidecarUrl + ": " + e.getMessage());
                // Return default fallback if ML service is down
                prediction = new HashMap<>();
                prediction.put("isFraud", amt > 250.0); // simple rule fallback
                prediction.put("riskScore", amt > 250.0 ? 75.0 : 5.0);
                prediction.put("confidenceScore", 50.0);
            }

            boolean isFraud = (Boolean) prediction.getOrDefault("isFraud", false);
            double riskScore = Double.parseDouble(prediction.getOrDefault("riskScore", "0.0").toString());
            double confidenceScore = Double.parseDouble(prediction.getOrDefault("confidenceScore", "0.0").toString());

            // 2. Query Neo4j for Graph Fraud Patterns
            Map<String, Object> graphSignals = databaseService.checkGraphFraudPatterns(ccNum, merchant);
            double graphRiskAdjustment = (Double) graphSignals.getOrDefault("graphRiskAdjustment", 0.0);
            
            // Augment prediction using Graph Signals
            if (graphRiskAdjustment > 0.0) {
                riskScore = Math.min(100.0, riskScore + graphRiskAdjustment);
                if (riskScore >= 29.62) { // dynamic update threshold
                    isFraud = true;
                }
            }

            // 3. Persist transaction, entities, and relationships to Neo4j
            databaseService.saveTransaction(
                transId, ccNum, amt, transDate, merchant, category, state, city,
                gender, 30, lat, lon, merchLat, merchLon, isFraud, riskScore
            );

            // 4. Send real-time alerts & lists via Spring WebSocket Stomp Broker
            String fullName = databaseService.getUserNameByCard(ccNum);
            
            Map<String, Object> wsPayload = new HashMap<>();
            wsPayload.put("id", transId);
            wsPayload.put("ccNum", ccNum);
            wsPayload.put("amt", amt);
            wsPayload.put("transDate", transDate);
            wsPayload.put("merchant", merchant);
            wsPayload.put("category", category);
            wsPayload.put("isFraud", isFraud);
            wsPayload.put("riskScore", riskScore);
            wsPayload.put("confidenceScore", confidenceScore);
            wsPayload.put("graphSignals", graphSignals);
            wsPayload.put("fullName", fullName);

            // Global real-time stream
            messagingTemplate.convertAndSend("/topic/transactions", wsPayload);

            if (isFraud) {
                // High-priority global alerts stream
                messagingTemplate.convertAndSend("/topic/alerts", wsPayload);
            }

            // Return response
            Map<String, Object> responsePayload = new HashMap<>();
            responsePayload.put("isFraud", isFraud);
            responsePayload.put("riskScore", riskScore);
            responsePayload.put("confidenceScore", confidenceScore);
            responsePayload.put("transId", transId);
            responsePayload.put("graphSignals", graphSignals);
            responsePayload.put("fullName", fullName);
            
            return ResponseEntity.ok(responsePayload);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/history")
    public ResponseEntity<?> getHistory() {
        try {
            String username = SecurityContextHolder.getContext().getAuthentication().getName();
            Map<String, Object> user = databaseService.findUserByUsername(username);
            
            if (user == null || user.get("ccNum").toString().isEmpty()) {
                // Return empty history or global history as fallback
                return ResponseEntity.ok(Collections.emptyList());
            }

            String ccNum = (String) user.get("ccNum");
            List<Map<String, Object>> history = databaseService.getTransactionHistory(ccNum, 50);
            return ResponseEntity.ok(history);
            
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/upload")
    public ResponseEntity<?> uploadBatchCSV(@RequestParam("file") MultipartFile file) {
        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Please upload a valid CSV file"));
            }

            long totalCount = 0;
            long fraudCount = 0;
            double sumRisk = 0.0;
            List<Map<String, Object>> previewList = new ArrayList<>();

            try (BufferedReader br = new BufferedReader(new InputStreamReader(file.getInputStream()))) {
                String headerLine = br.readLine(); // read header
                if (headerLine == null) {
                    return ResponseEntity.badRequest().body(Map.of("error", "CSV file is empty"));
                }

                // Parse header to find column indices
                String[] headerCols = headerLine.split(",");
                Map<String, Integer> colIndex = new HashMap<>();
                for (int i = 0; i < headerCols.length; i++) {
                    colIndex.put(headerCols[i].trim().toLowerCase(), i);
                }

                String line;
                while ((line = br.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;

                    // Robust CSV parsing: parse from right side since last fields (numeric/date) don't contain commas
                    // Expected header: cc_num,amt,merchant,category,gender,city,state,city_pop,job,dob,lat,long,merch_lat,merch_long,trans_date
                    // Fields with possible embedded commas: merchant (idx 2), job (idx 8)
                    String[] allParts = line.split(",");
                    if (allParts.length < 15) continue; // need at least 15 tokens

                    // Parse from the RIGHT: trans_date is last, then merch_long, merch_lat, long, lat, dob
                    int n = allParts.length;
                    String transDate = allParts[n - 1].trim();
                    // Handle trans_date that might have been split on space (e.g., "2026-05-23 15:00:00" is one field)
                    // If the last part looks like a time (HH:mm:ss), combine with previous
                    if (transDate.matches("\\d{2}:\\d{2}:\\d{2}")) {
                        transDate = allParts[n - 2].trim() + " " + transDate;
                        n = n - 1; // adjust end pointer
                    }
                    double merchLon = Double.parseDouble(allParts[n - 2].trim());
                    double merchLat = Double.parseDouble(allParts[n - 3].trim());
                    double lon = Double.parseDouble(allParts[n - 4].trim());
                    double lat = Double.parseDouble(allParts[n - 5].trim());
                    String dob = allParts[n - 6].trim();
                    // Job may have commas, so we need to figure out the boundary
                    // From the LEFT: cc_num=0, amt=1, then merchant+category+gender+city+state+city_pop occupy indices 2..?
                    // From the RIGHT: dob is at n-6, before that is job (which may span multiple parts)
                    
                    // Parse from LEFT: cc_num and amt are straightforward
                    String ccNum = allParts[0].trim();
                    double amt = Double.parseDouble(allParts[1].trim());

                    // city_pop is the rightmost purely numeric field before job
                    // Strategy: scan from right (before dob) backwards to find city_pop (a pure integer)
                    // city_pop is between state and job
                    // Working backwards from dob (at n-6), job parts are before that until we hit city_pop (pure integer)
                    int dobIdx = n - 6;
                    
                    // Find city_pop: scan leftward from dobIdx-1, city_pop is a large integer
                    int cityPopIdx = -1;
                    for (int i = dobIdx - 1; i >= 2; i--) {
                        String part = allParts[i].trim();
                        if (part.matches("\\d+") && Integer.parseInt(part) >= 0) {
                            cityPopIdx = i;
                            break;
                        }
                    }
                    
                    if (cityPopIdx < 0) continue; // skip malformed line

                    int cityPop = Integer.parseInt(allParts[cityPopIdx].trim());
                    // job = everything between cityPopIdx+1 and dobIdx-1 (inclusive), joined with commas
                    StringBuilder jobBuilder = new StringBuilder();
                    for (int i = cityPopIdx + 1; i <= dobIdx - 1; i++) {
                        if (jobBuilder.length() > 0) jobBuilder.append(", ");
                        jobBuilder.append(allParts[i].trim());
                    }
                    String job = jobBuilder.length() > 0 ? jobBuilder.toString() : "unknown_job";
                    
                    // state is at cityPopIdx-1, city at cityPopIdx-2, gender at cityPopIdx-3
                    String state = cityPopIdx >= 3 ? allParts[cityPopIdx - 1].trim() : "unknown_state";
                    String city = cityPopIdx >= 4 ? allParts[cityPopIdx - 2].trim() : "unknown_city";
                    String gender = cityPopIdx >= 5 ? allParts[cityPopIdx - 3].trim() : "M";
                    
                    // category is at cityPopIdx-4
                    String category = cityPopIdx >= 6 ? allParts[cityPopIdx - 4].trim() : "unknown_category";
                    
                    // merchant = everything from index 2 to cityPopIdx-5 (inclusive), joined with commas
                    int merchantEnd = cityPopIdx - 5;
                    StringBuilder merchantBuilder = new StringBuilder();
                    for (int i = 2; i <= merchantEnd; i++) {
                        if (merchantBuilder.length() > 0) merchantBuilder.append(", ");
                        merchantBuilder.append(allParts[i].trim());
                    }
                    String merchant = merchantBuilder.length() > 0 ? merchantBuilder.toString() : "unknown_merchant";

                    String transId = UUID.randomUUID().toString();

                    // Query prediction inline from ML service
                    HttpHeaders headers = new HttpHeaders();
                    headers.setContentType(MediaType.APPLICATION_JSON);
                    
                    Map<String, Object> req = new HashMap<>();
                    req.put("merchant", merchant);
                    req.put("category", category);
                    req.put("gender", gender);
                    req.put("city", city);
                    req.put("state", state);
                    req.put("city_pop", cityPop);
                    req.put("job", job);
                    req.put("dob", dob);
                    req.put("lat", lat);
                    req.put("long", lon);
                    req.put("merch_lat", merchLat);
                    req.put("merch_long", merchLon);
                    req.put("amt", amt);
                    req.put("cc_num", ccNum);
                    req.put("trans_date", transDate);
                    req.put("trans_id", transId);

                    HttpEntity<Map<String, Object>> entity = new HttpEntity<>(req, headers);
                    boolean isFraud = false;
                    double riskScore = 0.0;

                    try {
                        ResponseEntity<Map> response = restTemplate.postForEntity(mlSidecarUrl, entity, Map.class);
                        Map<String, Object> pred = response.getBody();
                        isFraud = (Boolean) pred.getOrDefault("isFraud", false);
                        riskScore = Double.parseDouble(pred.getOrDefault("riskScore", "0.0").toString());
                    } catch (Exception e) {
                        isFraud = amt > 250.0;
                        riskScore = amt > 250.0 ? 80.0 : 10.0;
                    }

                    // Save to Neo4j
                    databaseService.saveTransaction(
                        transId, ccNum, amt, transDate, merchant, category, state, city,
                        gender, 30, lat, lon, merchLat, merchLon, isFraud, riskScore
                    );

                    totalCount++;
                    if (isFraud) {
                        fraudCount++;
                    }
                    sumRisk += riskScore;

                    // Add first 15 predictions to list for summary dashboard table preview
                    if (previewList.size() < 15) {
                        previewList.add(Map.of(
                            "id", transId,
                            "ccNum", ccNum,
                            "amt", amt,
                            "transDate", transDate,
                            "merchant", merchant,
                            "isFraud", isFraud,
                            "riskScore", riskScore
                        ));
                    }
                }
            }

            double avgRisk = totalCount > 0 ? Math.round((sumRisk / totalCount) * 100.0) / 100.0 : 0.0;

            Map<String, Object> summary = new HashMap<>();
            summary.put("totalParsed", totalCount);
            summary.put("fraudCount", fraudCount);
            summary.put("averageRiskScore", avgRisk);
            summary.put("predictions", previewList);

            return ResponseEntity.ok(summary);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }
}
