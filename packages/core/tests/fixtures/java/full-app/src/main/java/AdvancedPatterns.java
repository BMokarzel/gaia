package com.example.fullapp;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import jakarta.persistence.*;
import java.util.*;
import java.util.stream.Collectors;

// ── Gap 9: Annotation type declaration ────────────────────────────────────────

@interface Cacheable {
    String key() default "";
    int ttl() default 300;
}

// ── Gap 1: Enum with methods ───────────────────────────────────────────────────

enum OrderStatus {
    PENDING, SHIPPED, DELIVERED, CANCELLED;

    public boolean isTerminal() {
        return this == DELIVERED || this == CANCELLED;
    }

    public boolean canTransitionTo(OrderStatus next) {
        if (this == CANCELLED) return false;
        return next.ordinal() > this.ordinal();
    }
}

// ── Gap 12: FeignClient interface ─────────────────────────────────────────────

@FeignClient(name = "user-service", url = "http://user-service:8081")
interface UserServiceClient {
    @GetMapping("/users/{id}")
    Object getUserById(@PathVariable Long id);

    @PostMapping("/users")
    Object createUser(@RequestBody Object user);

    @DeleteMapping("/users/{id}")
    void deleteUser(@PathVariable Long id);
}

// ── Gap 2 + 11: Outer class with inner/nested classes ─────────────────────────

public class OuterService {

    private static final Logger log = LoggerFactory.getLogger(OuterService.class);

    // Gap 4: Static initializer
    private static final Map<String, Integer> STATUS_CODES;
    static {
        STATUS_CODES = new HashMap<>();
        STATUS_CODES.put("OK", 200);
        STATUS_CODES.put("NOT_FOUND", 404);
        STATUS_CODES.put("ERROR", 500);
        log.info("Status codes initialized: {}", STATUS_CODES.size());
    }

    // Gap 2: Inner (non-static) class
    public class InnerHelper {
        public String format(String input) {
            return input.trim().toLowerCase();
        }

        public boolean validate(String input) {
            return input != null && !input.isEmpty();
        }
    }

    // Gap 2: Static nested class
    public static class StaticNested {
        private final String prefix;

        public StaticNested(String prefix) {
            this.prefix = prefix;
        }

        public String apply(String value) {
            return prefix + value;
        }
    }

    // Gap 3: Anonymous class usage
    public Runnable createTask(String message) {
        return new Runnable() {
            @Override
            public void run() {
                log.info("Executing task: {}", message);
                System.out.println("Running: " + message);
            }
        };
    }

    // Gap 5: Lambda with multi-statement block
    public List<String> processItems(List<String> items) {
        return items.stream().map(item -> {
            String trimmed = item.trim();
            String upper = trimmed.toUpperCase();
            log.debug("Processed item: {}", upper);
            return upper;
        }).filter(item -> {
            boolean valid = item.length() > 0;
            boolean notBlocked = !item.startsWith("BLOCKED_");
            return valid && notBlocked;
        }).collect(Collectors.toList());
    }

    // Gap 6: Method reference
    public List<String> getNames(List<Object> users) {
        return users.stream()
            .map(Object::toString)
            .collect(Collectors.toList());
    }

    // Gap 7: Deeply chained method calls
    public String buildChain(String input) {
        return Optional.ofNullable(input)
            .map(String::trim)
            .map(String::toLowerCase)
            .orElse("default");
    }

    // Gap 13: RestClient (Spring 6.1+)
    private RestClient restClient;

    public Object fetchUserRestClient(Long id) {
        return restClient
            .get()
            .uri("/users/" + id)
            .retrieve()
            .body(Object.class);
    }

    // Gap 14: URL in variable
    private RestTemplate restTemplate;

    public Object fetchWithVariableUrl(String serviceBaseUrl, Long userId) {
        String endpoint = "/api/users/" + userId;
        String url = serviceBaseUrl + endpoint;
        return restTemplate.getForObject(url, Object.class);
    }

    // Gap 15: Java 14+ switch expression with arrow syntax
    public String describeStatus(OrderStatus status) {
        return switch (status) {
            case PENDING   -> "Waiting for processing";
            case SHIPPED   -> "In transit";
            case DELIVERED -> "Successfully delivered";
            case CANCELLED -> "Order was cancelled";
        };
    }

    // Gap 16: Labeled statement
    public int findFirst(int[][] matrix, int target) {
        int result = -1;
        outer: for (int i = 0; i < matrix.length; i++) {
            for (int j = 0; j < matrix[i].length; j++) {
                if (matrix[i][j] == target) {
                    result = i * 100 + j;
                    break outer;
                }
            }
        }
        return result;
    }
}
