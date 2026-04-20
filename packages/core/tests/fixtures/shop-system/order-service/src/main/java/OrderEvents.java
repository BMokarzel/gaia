package com.example.orderservice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderEvents {
    private static final Logger log = LoggerFactory.getLogger(OrderEvents.class);
    private final OrderRepository orderRepository;

    public OrderEvents(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @KafkaListener(topics = "user.created", groupId = "order-service")
    public void onUserCreated(String message) {
        log.info("received user.created event: {}", message);
    }

    @KafkaListener(topics = "user.deleted", groupId = "order-service")
    public void onUserDeleted(String message) {
        log.info("received user.deleted event: {}", message);
        try {
            Long userId = Long.parseLong(message);
            List<Order> orders = orderRepository.findAll();
            for (Order order : orders) {
                if (order.getUserId().equals(userId)) {
                    order.setStatus("cancelled");
                    orderRepository.save(order);
                    log.info("cancelled order for deleted user order_id={}", order.getId());
                }
            }
        } catch (Exception e) {
            log.error("failed to process user.deleted event", e);
            throw new RuntimeException("event processing failed", e);
        }
    }
}
