package com.example.fullapp;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.*;

import jakarta.persistence.*;
import java.util.List;
import java.util.Optional;

// ── JPA Entity ───────────────────────────────────────────────────────────────

@Entity
@Table(name = "users")
class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "email", unique = true)
    private String email;

    @Column(name = "role")
    private String role;

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getEmail() { return email; }
}

@Entity
@Table(name = "orders")
class Order {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "total")
    private Double total;
}

// ── Repository ───────────────────────────────────────────────────────────────

interface UserRepository extends org.springframework.data.jpa.repository.JpaRepository<User, Long> {
    Optional<User> findByEmail(String email);
    List<User> findByRole(String role);
}

// ── Controller ───────────────────────────────────────────────────────────────

@RestController
@RequestMapping("/users")
public class UserController {

    private static final Logger log = LoggerFactory.getLogger(UserController.class);

    private final UserRepository userRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;

    public UserController(UserRepository userRepository, KafkaTemplate<String, String> kafkaTemplate) {
        this.userRepository = userRepository;
        this.kafkaTemplate = kafkaTemplate;
    }

    @GetMapping
    public ResponseEntity<List<User>> getUsers() {
        log.info("Fetching all users");
        List<User> users = userRepository.findAll();
        log.debug("Found {} users", users.size());
        return ResponseEntity.ok(users);
    }

    @PostMapping
    public ResponseEntity<User> createUser(@RequestBody User user) {
        log.info("Creating user: {}", user.getName());

        if (user.getName() == null || user.getName().isEmpty()) {
            log.warn("Attempted to create user with empty name");
            return ResponseEntity.badRequest().build();
        }

        try {
            User saved = userRepository.save(user);
            kafkaTemplate.send("user.created", String.valueOf(saved.getId()));
            log.info("User created with id={}", saved.getId());
            return ResponseEntity.status(HttpStatus.CREATED).body(saved);
        } catch (Exception e) {
            log.error("Failed to create user", e);
            throw new RuntimeException("User creation failed", e);
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getUserById(@PathVariable Long id) {
        log.debug("Fetching user id={}", id);

        Optional<User> user = userRepository.findById(id);
        if (user.isEmpty()) {
            log.warn("User not found id={}", id);
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(user.get());
    }

    @PutMapping("/{id}")
    public ResponseEntity<User> updateUser(@PathVariable Long id, @RequestBody User input) {
        log.info("Updating user id={}", id);

        return userRepository.findById(id).map(existing -> {
            User updated = userRepository.save(input);
            kafkaTemplate.send("user.updated", String.valueOf(id));
            log.info("User updated id={}", id);
            return ResponseEntity.ok(updated);
        }).orElseGet(() -> {
            log.warn("User not found for update id={}", id);
            return ResponseEntity.notFound().build();
        });
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable Long id) {
        log.info("Deleting user id={}", id);

        if (!userRepository.existsById(id)) {
            log.warn("User not found for delete id={}", id);
            throw new IllegalArgumentException("User not found: " + id);
        }

        userRepository.deleteById(id);
        kafkaTemplate.send("user.deleted", String.valueOf(id));
        log.info("User deleted id={}", id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/role/{role}")
    public ResponseEntity<List<User>> getUsersByRole(@PathVariable String role) {
        log.debug("Fetching users by role={}", role);

        switch (role) {
            case "admin":
                log.info("Fetching admin users");
                break;
            case "guest":
                log.info("Fetching guest users");
                break;
            default:
                log.warn("Unknown role requested: {}", role);
        }

        List<User> users = userRepository.findByRole(role);
        return ResponseEntity.ok(users);
    }
}
