package com.example;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/users")
public class UserController {

    @GetMapping
    public List<User> listUsers() {
        return List.of();
    }

    @GetMapping("/{id}")
    public User getUser(@PathVariable String id) {
        return new User(id, "");
    }

    @PostMapping
    public User createUser(@RequestBody User user) {
        return user;
    }

    @PutMapping("/{id}")
    public User updateUser(@PathVariable String id, @RequestBody User user) {
        return user;
    }

    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable String id) {}

    record User(String id, String name) {}
}
