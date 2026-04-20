package com.example.orderservice;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.util.List;
import java.util.Optional;

interface OrderRepository extends org.springframework.data.jpa.repository.JpaRepository<Order, Long> {
    java.util.List<Order> findByUserId(Long userId);
}

@Service
public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);
    private static final String USER_SERVICE_URL = "http://user-service:8081";

    private final OrderRepository orderRepository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final RestTemplate restTemplate;

    public OrderService(OrderRepository orderRepository,
                        KafkaTemplate<String, String> kafkaTemplate,
                        RestTemplate restTemplate) {
        this.orderRepository = orderRepository;
        this.kafkaTemplate = kafkaTemplate;
        this.restTemplate = restTemplate;
    }

    public List<Order> findAll() {
        log.debug("fetching all orders from repository");
        return orderRepository.findAll();
    }

    public Optional<Order> findById(Long id) {
        log.debug("fetching order id={}", id);
        return orderRepository.findById(id);
    }

    public Order create(Order order) {
        log.info("validating user_id={}", order.getUserId());
        String userUrl = USER_SERVICE_URL + "/users/" + order.getUserId();
        try {
            restTemplate.getForObject(userUrl, Object.class);
        } catch (Exception e) {
            log.error("user not found user_id={}", order.getUserId());
            throw new IllegalArgumentException("user not found: " + order.getUserId());
        }

        order.setStatus("pending");
        Order saved = orderRepository.save(order);

        kafkaTemplate.send("order.placed", String.valueOf(saved.getId()));
        log.info("order.placed event published order_id={}", saved.getId());

        return saved;
    }

    public Order update(Long id, Order input) {
        Order existing = orderRepository.findById(id)
            .orElseThrow(() -> new IllegalArgumentException("order not found: " + id));

        switch (input.getStatus()) {
            case "shipped":
                log.info("order shipped order_id={}", id);
                kafkaTemplate.send("order.shipped", String.valueOf(id));
                break;
            case "cancelled":
                log.info("order cancelled order_id={}", id);
                break;
            default:
                log.warn("unknown status transition status={}", input.getStatus());
        }

        existing.setStatus(input.getStatus());
        return orderRepository.save(existing);
    }

    public boolean exists(Long id) {
        return orderRepository.existsById(id);
    }

    public void delete(Long id) {
        log.info("deleting order id={}", id);
        orderRepository.deleteById(id);
    }
}
