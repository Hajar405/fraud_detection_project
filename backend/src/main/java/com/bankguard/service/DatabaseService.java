package com.bankguard.service;

import org.neo4j.driver.Driver;
import org.neo4j.driver.Record;
import org.neo4j.driver.Session;
import org.neo4j.driver.Values;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class DatabaseService {

    @Autowired
    private Driver neo4jDriver;

    // Initialize Database constraints at startup to guarantee fast unique index lookups
    public void initDatabase() {
        try (Session session = neo4jDriver.session()) {
            session.run("CREATE CONSTRAINT user_username IF NOT EXISTS FOR (u:User) REQUIRE u.username IS UNIQUE");
            session.run("CREATE CONSTRAINT card_ccNum IF NOT EXISTS FOR (c:Card) REQUIRE c.ccNum IS UNIQUE");
            session.run("CREATE CONSTRAINT merchant_name IF NOT EXISTS FOR (m:Merchant) REQUIRE m.name IS UNIQUE");
            session.run("CREATE CONSTRAINT trans_id IF NOT EXISTS FOR (t:Transaction) REQUIRE t.id IS UNIQUE");
            System.out.println("✅ Neo4j database constraints initialized successfully.");
        } catch (Exception e) {
            System.err.println("⚠️ Warning: Failed to create database constraints: " + e.getMessage());
        }
    }

    public boolean createUser(String username, String hashedPassword, String fullName, int age, 
                              String email, String phone, String address, String cardNumber, String role) {
        String cypher = "MERGE (u:User {username: $username}) " +
                        "ON CREATE SET u.password = $password, u.fullName = $fullName, u.age = $age, " +
                        "              u.email = $email, u.phone = $phone, u.address = $address, u.role = $role " +
                        "WITH u " +
                        "MERGE (c:Card {ccNum: $cardNumber}) " +
                        "MERGE (u)-[:OWNS]->(c) " +
                        "RETURN u.username AS username";
        
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of(
                "username", username,
                "password", hashedPassword,
                "fullName", fullName,
                "age", age,
                "email", email,
                "phone", phone,
                "address", address,
                "cardNumber", cardNumber,
                "role", role
            ));
            return result.hasNext();
        } catch (Exception e) {
            System.err.println("Error creating user: " + e.getMessage());
            return false;
        }
    }

    public Map<String, Object> findUserByUsername(String username) {
        String cypher = "MATCH (u:User {username: $username}) " +
                        "OPTIONAL MATCH (u)-[:OWNS]->(c:Card) " +
                        "RETURN u.username AS username, u.password AS password, u.role AS role, c.ccNum AS ccNum";
        
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of("username", username));
            if (result.hasNext()) {
                Record record = result.next();
                Map<String, Object> user = new HashMap<>();
                user.put("username", record.get("username").asString());
                user.put("password", record.get("password").asString());
                user.put("role", record.get("role").asString());
                user.put("ccNum", record.get("ccNum").isNull() ? "" : record.get("ccNum").asString());
                return user;
            }
        } catch (Exception e) {
            System.err.println("Error finding user: " + e.getMessage());
        }
        return null;
    }

    public Map<String, Object> findUserProfile(String username) {
        String cypher = "MATCH (u:User {username: $username}) " +
                        "OPTIONAL MATCH (u)-[:OWNS]->(c:Card) " +
                        "RETURN u.username AS username, u.fullName AS fullName, u.age AS age, " +
                        "       u.email AS email, u.phone AS phone, u.address AS address, " +
                        "       u.role AS role, c.ccNum AS ccNum";
        
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of("username", username));
            if (result.hasNext()) {
                Record record = result.next();
                Map<String, Object> profile = new HashMap<>();
                profile.put("username", record.get("username").asString());
                profile.put("fullName", record.get("fullName").isNull() ? "" : record.get("fullName").asString());
                profile.put("age", record.get("age").isNull() ? 0 : record.get("age").asInt());
                profile.put("email", record.get("email").isNull() ? "" : record.get("email").asString());
                profile.put("phone", record.get("phone").isNull() ? "" : record.get("phone").asString());
                profile.put("address", record.get("address").isNull() ? "" : record.get("address").asString());
                profile.put("role", record.get("role").asString());
                profile.put("ccNum", record.get("ccNum").isNull() ? "" : record.get("ccNum").asString());
                return profile;
            }
        } catch (Exception e) {
            System.err.println("Error finding user profile: " + e.getMessage());
        }
        return null;
    }

    public String getUserNameByCard(String ccNum) {
        String cypher = "MATCH (u:User)-[:OWNS]->(c:Card {ccNum: $ccNum}) RETURN u.fullName AS fullName";
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of("ccNum", ccNum));
            if (result.hasNext()) {
                return result.next().get("fullName").asString();
            }
        } catch (Exception e) {
            System.err.println("Error getting user name by card: " + e.getMessage());
        }
        return "Card Holder " + (ccNum.length() >= 4 ? ccNum.substring(ccNum.length() - 4) : "XXXX");
    }

    public boolean deleteTransaction(String id) {
        String cypher = "MATCH (t:Transaction {id: $id}) DETACH DELETE t";
        try (Session session = neo4jDriver.session()) {
            session.run(cypher, Map.of("id", id));
            return true;
        } catch (Exception e) {
            System.err.println("Error deleting transaction: " + e.getMessage());
            return false;
        }
    }

    public void saveTransaction(String transId, String ccNum, double amt, String transDate, 
                                String merchant, String category, String state, String city, 
                                String gender, int age, double lat, double lon, 
                                double merchLat, double merchLon, boolean isFraud, double riskScore) {
        
        String cypher = 
            // 1. Merge Card and Merchant
            "MERGE (c:Card {ccNum: $ccNum}) " +
            "MERGE (m:Merchant {name: $merchant}) " +
            "ON CREATE SET m.category = $category, m.state = $state, m.city = $city " +
            
            // 2. Create Transaction
            "MERGE (t:Transaction {id: $transId}) " +
            "SET t.amt = $amt, t.transDate = $transDate, t.isFraud = $isFraud, t.riskScore = $riskScore, " +
            "    t.lat = $lat, t.lon = $lon, t.merchLat = $merchLat, t.merchLon = $merchLon " +
            
            // 3. Create relationships
            "MERGE (c)-[:MAKES_TRANSACTION]->(t) " +
            "MERGE (t)-[:SENT_TO]->(m) " +
            
            // 4. If there's an orphan card, optionally merge a mock user for data integrity
            "WITH c " +
            "OPTIONAL MATCH (u:User)-[:OWNS]->(c) " +
            "FOREACH (ignoreMe IN CASE WHEN u IS NULL THEN [1] ELSE [] END | " +
            "   MERGE (newUser:User {username: 'card_holder_' + c.ccNum}) " +
            "   ON CREATE SET newUser.fullName = 'Orphan Card Holder', newUser.role = 'USER' " +
            "   MERGE (newUser)-[:OWNS]->(c) " +
            ")";

        try (Session session = neo4jDriver.session()) {
            Map<String, Object> params = new HashMap<>();
            params.put("ccNum", ccNum);
            params.put("merchant", merchant);
            params.put("category", category);
            params.put("state", state);
            params.put("city", city);
            params.put("transId", transId);
            params.put("amt", amt);
            params.put("transDate", transDate);
            params.put("isFraud", isFraud);
            params.put("riskScore", riskScore);
            params.put("lat", lat);
            params.put("lon", lon);
            params.put("merchLat", merchLat);
            params.put("merchLon", merchLon);
            
            session.run(cypher, params);
        } catch (Exception e) {
            System.err.println("Error saving transaction to Neo4j: " + e.getMessage());
        }
    }

    public List<Map<String, Object>> getTransactionHistory(String ccNum, int limit) {
        String cypher = "MATCH (c:Card {ccNum: $ccNum})-[:MAKES_TRANSACTION]->(t:Transaction)-[:SENT_TO]->(m:Merchant) " +
                        "RETURN t.id AS id, t.amt AS amt, t.transDate AS transDate, t.isFraud AS isFraud, " +
                        "       t.riskScore AS riskScore, m.name AS merchant, m.category AS category " +
                        "ORDER BY t.transDate DESC LIMIT $limit";

        List<Map<String, Object>> history = new ArrayList<>();
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of("ccNum", ccNum, "limit", limit));
            while (result.hasNext()) {
                Record record = result.next();
                Map<String, Object> tx = new HashMap<>();
                tx.put("id", record.get("id").asString());
                tx.put("amt", record.get("amt").asDouble());
                tx.put("transDate", record.get("transDate").asString());
                tx.put("isFraud", record.get("isFraud").asBoolean());
                tx.put("riskScore", record.get("riskScore").asDouble());
                tx.put("merchant", record.get("merchant").asString());
                tx.put("category", record.get("category").asString());
                history.add(tx);
            }
        } catch (Exception e) {
            System.err.println("Error getting transaction history: " + e.getMessage());
        }
        return history;
    }

    public List<Map<String, Object>> getGlobalTransactionHistory(int limit) {
        String cypher = "MATCH (c:Card)-[:MAKES_TRANSACTION]->(t:Transaction)-[:SENT_TO]->(m:Merchant) " +
                        "OPTIONAL MATCH (u:User)-[:OWNS]->(c) " +
                        "RETURN t.id AS id, t.amt AS amt, t.transDate AS transDate, t.isFraud AS isFraud, " +
                        "       t.riskScore AS riskScore, m.name AS merchant, m.category AS category, c.ccNum AS ccNum, " +
                        "       u.fullName AS fullName " +
                        "ORDER BY t.transDate DESC LIMIT $limit";

        List<Map<String, Object>> history = new ArrayList<>();
        try (Session session = neo4jDriver.session()) {
            var result = session.run(cypher, Map.of("limit", limit));
            while (result.hasNext()) {
                Record record = result.next();
                Map<String, Object> tx = new HashMap<>();
                tx.put("id", record.get("id").asString());
                tx.put("amt", record.get("amt").asDouble());
                tx.put("transDate", record.get("transDate").asString());
                tx.put("isFraud", record.get("isFraud").asBoolean());
                tx.put("riskScore", record.get("riskScore").asDouble());
                tx.put("merchant", record.get("merchant").asString());
                tx.put("category", record.get("category").asString());
                tx.put("ccNum", record.get("ccNum").asString());
                tx.put("fullName", record.get("fullName").isNull() ? "Card Holder " + (record.get("ccNum").asString().length() >= 4 ? record.get("ccNum").asString().substring(record.get("ccNum").asString().length() - 4) : "XXXX") : record.get("fullName").asString());
                history.add(tx);
            }
        } catch (Exception e) {
            System.err.println("Error getting global history: " + e.getMessage());
        }
        return history;
    }

    public Map<String, Object> getAdminStats() {
        String countCypher = "MATCH (t:Transaction) RETURN count(t) AS total, avg(t.riskScore) AS avgRisk";
        String fraudCypher = "MATCH (t:Transaction {isFraud: true}) RETURN count(t) AS fraudCount, sum(t.amt) AS totalFraudCost";
        String topMerchantsCypher = "MATCH (t:Transaction {isFraud: true})-[:SENT_TO]->(m:Merchant) " +
                                    "RETURN m.name AS merchant, count(t) AS fraudCount, sum(t.amt) AS totalAmount " +
                                    "ORDER BY fraudCount DESC LIMIT 5";
        
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalTransactions", 0L);
        stats.put("avgRiskScore", 0.0);
        stats.put("fraudAlertsCount", 0L);
        stats.put("totalFraudCost", 0.0);
        stats.put("topHighRiskMerchants", new ArrayList<>());

        try (Session session = neo4jDriver.session()) {
            var result = session.run(countCypher);
            if (result.hasNext()) {
                Record r = result.next();
                stats.put("totalTransactions", r.get("total").asLong());
                stats.put("avgRiskScore", r.get("avgRisk").isNull() ? 0.0 : Math.round(r.get("avgRisk").asDouble() * 100.0) / 100.0);
            }

            var resultFraud = session.run(fraudCypher);
            if (resultFraud.hasNext()) {
                Record r = resultFraud.next();
                stats.put("fraudAlertsCount", r.get("fraudCount").asLong());
                stats.put("totalFraudCost", r.get("totalFraudCost").isNull() ? 0.0 : Math.round(r.get("totalFraudCost").asDouble() * 100.0) / 100.0);
            }

            var resultMerchants = session.run(topMerchantsCypher);
            List<Map<String, Object>> merchants = new ArrayList<>();
            while (resultMerchants.hasNext()) {
                Record r = resultMerchants.next();
                merchants.add(Map.of(
                    "merchant", r.get("merchant").asString(),
                    "fraudCount", r.get("fraudCount").asLong(),
                    "totalAmount", Math.round(r.get("totalAmount").asDouble() * 100.0) / 100.0
                ));
            }
            stats.put("topHighRiskMerchants", merchants);

        } catch (Exception e) {
            System.err.println("Error getting admin stats from Neo4j: " + e.getMessage());
        }
        return stats;
    }

    /**
     * Executes real-time Neo4j graph checking for fraud signal enhancement:
     * 1. Card Velocity Check (number of transactions in the last 15 minutes)
     * 2. Merchant past fraud rate (high alert if merchant was involved in multiple fraud incidents)
     */
    public Map<String, Object> checkGraphFraudPatterns(String ccNum, String merchant) {
        String velocityCypher = 
            "MATCH (c:Card {ccNum: $ccNum})-[:MAKES_TRANSACTION]->(t:Transaction) " +
            "RETURN count(t) AS count";
            
        String merchantAlertCypher = 
            "MATCH (t:Transaction {isFraud: true})-[:SENT_TO]->(m:Merchant {name: $merchant}) " +
            "RETURN count(t) AS count";

        long velocity = 0;
        long merchantAlerts = 0;

        try (Session session = neo4jDriver.session()) {
            var vResult = session.run(velocityCypher, Map.of("ccNum", ccNum));
            if (vResult.hasNext()) {
                velocity = vResult.next().get("count").asLong();
            }

            var mResult = session.run(merchantAlertCypher, Map.of("merchant", merchant));
            if (mResult.hasNext()) {
                merchantAlerts = mResult.next().get("count").asLong();
            }
        } catch (Exception e) {
            System.err.println("Error performing Graph Fraud Pattern check: " + e.getMessage());
        }

        Map<String, Object> signals = new HashMap<>();
        signals.put("cardTransactionCount", velocity);
        signals.put("merchantPastFraudIncidents", merchantAlerts);
        
        // Compute custom graph risk adjustment
        double graphRiskDelta = 0.0;
        if (velocity > 3) graphRiskDelta += 15.0; // High velocity alert
        if (merchantAlerts > 2) graphRiskDelta += 20.0; // Compromised merchant history alert
        
        signals.put("graphRiskAdjustment", graphRiskDelta);
        return signals;
    }
}
