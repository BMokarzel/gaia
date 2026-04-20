package main

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type App struct {
	db        *gorm.DB
	publisher *EventPublisher
}

func (a *App) ListUsers(c *gin.Context) {
	logrus.Info("listing users")
	var users []User
	if err := a.db.Find(&users).Error; err != nil {
		logrus.WithError(err).Error("failed to list users")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	logrus.WithField("count", len(users)).Info("users listed")
	c.JSON(http.StatusOK, users)
}

func (a *App) CreateUser(c *gin.Context) {
	logrus.Info("creating user")
	var user User
	if err := c.ShouldBindJSON(&user); err != nil {
		logrus.WithError(err).Warn("invalid request body")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if user.Name == "" {
		logrus.Warn("name is required")
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	result := a.db.Create(&user)
	if result.Error != nil {
		logrus.WithError(result.Error).Error("failed to create user")
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	go a.publisher.PublishUserCreated(context.Background(), user.ID)
	logrus.WithField("id", user.ID).Info("user created")
	c.JSON(http.StatusCreated, user)
}

func (a *App) GetUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		panic("missing user id")
	}
	logrus.WithField("id", id).Debug("fetching user")
	var user User
	result := a.db.First(&user, id)
	if result.Error != nil {
		logrus.WithField("id", id).Warn("user not found")
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (a *App) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	logrus.WithField("id", id).Info("updating user")
	var input User
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	switch input.Role {
	case "admin":
		logrus.Info("promoting to admin")
	case "guest":
		logrus.Info("demoting to guest")
	default:
		logrus.WithField("role", input.Role).Warn("unknown role")
	}
	result := a.db.Updates(&input)
	if result.Error != nil {
		logrus.WithError(result.Error).Error("failed to update user")
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, input)
}

func (a *App) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		panic("missing user id for delete")
	}
	logrus.WithField("id", id).Info("deleting user")
	var user User
	result := a.db.First(&user, id)
	if result.Error != nil {
		logrus.WithField("id", id).Warn("user not found for delete")
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	a.db.Delete(&User{}, id)
	go a.publisher.PublishUserDeleted(context.Background(), user.ID)
	logrus.WithField("id", id).Info("user deleted")
	c.JSON(http.StatusNoContent, nil)
}

func main() {
	dsn := "host=localhost user=app password=secret dbname=users port=5432"
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatal("failed to connect to database")
	}

	publisher := &EventPublisher{}
	app := &App{db: db, publisher: publisher}

	r := gin.Default()
	r.GET("/users", app.ListUsers)
	r.POST("/users", app.CreateUser)
	r.GET("/users/:id", app.GetUser)
	r.PUT("/users/:id", app.UpdateUser)
	r.DELETE("/users/:id", app.DeleteUser)

	logrus.Info("user-service starting on :8081")
	r.Run(":8081")
}
