package com.example.orderservice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/orders")
public class OrderController {
    private static final Logger log = LoggerFactory.getLogger(OrderController.class);
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping
    public ResponseEntity<List<Order>> listOrders() {
        log.info("listing orders");
        List<Order> orders = orderService.findAll();
        log.debug("found {} orders", orders.size());
        return ResponseEntity.ok(orders);
    }

    @PostMapping
    public ResponseEntity<Order> createOrder(@RequestBody Order order) {
        log.info("creating order for user_id={}", order.getUserId());
        try {
            Order created = orderService.create(order);
            log.info("order created id={}", created.getId());
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (Exception e) {
            log.error("failed to create order", e);
            throw new RuntimeException("order creation failed", e);
        }
    }

    @GetMapping("/{id}")
    public ResponseEntity<Order> getOrder(@PathVariable Long id) {
        log.debug("fetching order id={}", id);
        return orderService.findById(id)
            .map(ResponseEntity::ok)
            .orElseGet(() -> {
                log.warn("order not found id={}", id);
                return ResponseEntity.notFound().build();
            });
    }

    @PutMapping("/{id}")
    public ResponseEntity<Order> updateOrder(@PathVariable Long id, @RequestBody Order input) {
        log.info("updating order id={}", id);
        try {
            Order updated = orderService.update(id, input);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            log.warn("order not found for update id={}", id);
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteOrder(@PathVariable Long id) {
        log.info("deleting order id={}", id);
        if (!orderService.exists(id)) {
            log.warn("order not found for delete id={}", id);
            throw new IllegalArgumentException("order not found: " + id);
        }
        orderService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
