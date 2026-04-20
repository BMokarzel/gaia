package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/segmentio/kafka-go"
	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ── GORM model (DbProcess via struct detection) ─────────────────────────────

type User struct {
	gorm.Model
	Name  string `gorm:"column:name"`
	Email string `gorm:"column:email;uniqueIndex"`
	Role  string `gorm:"column:role"`
}

type Order struct {
	gorm.Model
	UserID uint   `gorm:"column:user_id"`
	Total  float64 `gorm:"column:total"`
}

// ── Application struct ───────────────────────────────────────────────────────

type App struct {
	db     *gorm.DB
	router *gin.Engine
	writer *kafka.Writer
	reader *kafka.Reader
}

// ── Endpoints (Gin) ──────────────────────────────────────────────────────────

func (a *App) GetUsers(c *gin.Context) {
	logrus.Info("handling get users request")

	var users []User
	if err := a.db.Find(&users); err != nil {
		logrus.Error("failed to fetch users")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err})
		return
	}

	logrus.WithFields(logrus.Fields{"count": len(users)}).Info("users fetched")
	c.JSON(http.StatusOK, users)
}

func (a *App) CreateUser(c *gin.Context) {
	logrus.Info("handling create user")

	var input User
	if err := c.ShouldBindJSON(&input); err != nil {
		logrus.Warn("invalid request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := a.db.Create(&input)
	if result.Error != nil {
		logrus.WithField("error", result.Error).Error("failed to create user")
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error})
		return
	}

	a.publishUserCreated(input.ID)
	logrus.WithField("id", input.ID).Info("user created")
	c.JSON(http.StatusCreated, input)
}

func (a *App) GetUserByID(c *gin.Context) {
	id := c.Param("id")

	switch id {
	case "":
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing id"})
		return
	default:
		var user User
		result := a.db.First(&user, id)
		if result.Error != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusOK, user)
	}
}

func (a *App) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	var input User
	c.ShouldBindJSON(&input)

	for i := 0; i < 3; i++ {
		result := a.db.Updates(&input)
		if result.Error == nil {
			break
		}
		logrus.WithField("attempt", i).Warn("retry update")
	}

	c.JSON(http.StatusOK, gin.H{"updated": id})
}

func (a *App) DeleteUser(c *gin.Context) {
	id := c.Param("id")

	if id == "" {
		panic("missing user id")
	}

	a.db.Delete(&User{}, id)
	log.Printf("user deleted: %s", id)
	c.JSON(http.StatusNoContent, nil)
}

func (a *App) GetOrders(c *gin.Context) {
	var orders []Order
	a.db.Find(&orders)
	c.JSON(http.StatusOK, orders)
}

// ── Business logic ───────────────────────────────────────────────────────────

func (a *App) publishUserCreated(id uint) {
	ctx := context.Background()
	topic := "user.created"

	err := a.writer.WriteMessages(ctx, kafka.Message{
		Topic: topic,
		Value: []byte(fmt.Sprintf(`{"id":%d}`, id)),
	})
	if err != nil {
		logrus.WithError(err).Error("failed to publish user.created event")
		return
	}
	logrus.WithField("topic", topic).Info("event published")
}

func (a *App) ConsumeEvents() {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Topic:   "order.placed",
		GroupID: "full-app",
	})

	for {
		msg, err := reader.ReadMessage(context.Background())
		if err != nil {
			logrus.WithError(err).Error("failed to read message")
			break
		}
		a.processOrder(msg.Value)
	}
}

func (a *App) processOrder(data []byte) {
	logrus.WithField("data", string(data)).Debug("processing order")

	var order Order
	a.db.Create(&order)

	if order.Total > 1000 {
		logrus.Info("high value order detected")
		a.notifyHighValue(order)
	}
}

func (a *App) notifyHighValue(order Order) {
	logrus.WithField("order_id", order.ID).Info("notifying high value order")
	fmt.Printf("high value order: %d\n", order.ID)
}

// ── Main ─────────────────────────────────────────────────────────────────────

func main() {
	dsn := "host=localhost user=app password=secret dbname=app port=5432"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect database")
	}

	app := &App{db: db, router: gin.Default()}

	app.router.GET("/users", app.GetUsers)
	app.router.POST("/users", app.CreateUser)
	app.router.GET("/users/:id", app.GetUserByID)
	app.router.PUT("/users/:id", app.UpdateUser)
	app.router.DELETE("/users/:id", app.DeleteUser)
	app.router.GET("/orders", app.GetOrders)

	logrus.Info("server starting on :8080")
	app.router.Run(":8080")
}
