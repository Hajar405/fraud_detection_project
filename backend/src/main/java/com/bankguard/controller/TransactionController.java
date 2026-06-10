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
                System.err.println("⚠️ ML sidecar indisponible : " + mlSidecarUrl + " : " + e.getMessage());
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                        .body(Map.of("error", "Le service d'analyse est temporairement indisponible. Veuillez réessayer dans quelques instants."));
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

    @GetMapping("/streaming/status")
    public ResponseEntity<?> getStreamingStatus() {
        return ResponseEntity.ok(Map.of("enabled", databaseService.isStreamingEnabled()));
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

    private static List<String> parseCsvLine(String line) {
        List<String> result = new ArrayList<>();
        StringBuilder sb = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                inQuotes = !inQuotes;
            } else if (c == ',' && !inQuotes) {
                result.add(sb.toString().trim());
                sb.setLength(0);
            } else {
                sb.append(c);
            }
        }
        result.add(sb.toString().trim());
        return result;
    }

    private static String getColValue(List<String> parts, Map<String, Integer> colIndex, String[] keys, String defaultValue) {
        for (String key : keys) {
            Integer idx = colIndex.get(key.toLowerCase());
            if (idx != null && idx >= 0 && idx < parts.size()) {
                String val = parts.get(idx).trim();
                if (val.startsWith("\"") && val.endsWith("\"") && val.length() >= 2) {
                    val = val.substring(1, val.length() - 1).trim();
                }
                return val;
            }
        }
        return defaultValue;
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
                List<String> headerCols = parseCsvLine(headerLine);
                Map<String, Integer> colIndex = new HashMap<>();
                for (int i = 0; i < headerCols.size(); i++) {
                    colIndex.put(headerCols.get(i).trim().toLowerCase(), i);
                }

                String line;
                while ((line = br.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;

                    List<String> parts = parseCsvLine(line);
                    if (parts.size() < 3) continue;

                    // Extract columns dynamically using our flexible helper
                    String ccNum = getColValue(parts, colIndex, new String[]{"cc_num", "ccnum", "card_number"}, "unknown_card");
                    double amt = 0.0;
                    try {
                        amt = Double.parseDouble(getColValue(parts, colIndex, new String[]{"amt", "amount"}, "0.0"));
                    } catch (NumberFormatException e) {}

                    String merchant = getColValue(parts, colIndex, new String[]{"merchant", "merch"}, "unknown_merchant");
                    String category = getColValue(parts, colIndex, new String[]{"category", "cat"}, "unknown_category");
                    String gender = getColValue(parts, colIndex, new String[]{"gender", "sex"}, "M");
                    String city = getColValue(parts, colIndex, new String[]{"city"}, "unknown_city");
                    String state = getColValue(parts, colIndex, new String[]{"state"}, "unknown_state");

                    int cityPop = 1000;
                    try {
                        cityPop = Integer.parseInt(getColValue(parts, colIndex, new String[]{"city_pop", "citypop", "population"}, "1000"));
                    } catch (NumberFormatException e) {}

                    String job = getColValue(parts, colIndex, new String[]{"job", "profession"}, "unknown_job");
                    String dob = getColValue(parts, colIndex, new String[]{"dob", "date_of_birth"}, "1990-01-01");

                    double lat = 0.0;
                    try {
                        lat = Double.parseDouble(getColValue(parts, colIndex, new String[]{"lat", "latitude"}, "0.0"));
                    } catch (NumberFormatException e) {}

                    double lon = 0.0;
                    try {
                        lon = Double.parseDouble(getColValue(parts, colIndex, new String[]{"long", "longitude"}, "0.0"));
                    } catch (NumberFormatException e) {}

                    double merchLat = 0.0;
                    try {
                        merchLat = Double.parseDouble(getColValue(parts, colIndex, new String[]{"merch_lat", "merch_latitude"}, "0.0"));
                    } catch (NumberFormatException e) {}

                    double merchLon = 0.0;
                    try {
                        merchLon = Double.parseDouble(getColValue(parts, colIndex, new String[]{"merch_long", "merch_longitude"}, "0.0"));
                    } catch (NumberFormatException e) {}

                    String transDate = getColValue(parts, colIndex, new String[]{"trans_date", "trans_date_trans_time", "date"}, new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date()));
                    String transId = getColValue(parts, colIndex, new String[]{"trans_num", "trans_id", "id"}, UUID.randomUUID().toString());

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
                        System.err.println("⚠️ ML sidecar indisponible lors du batch CSV : " + e.getMessage());
                        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                                .body(Map.of("error", "Le service d'analyse est temporairement indisponible. L'import CSV ne peut pas être traité pour le moment."));
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
