package main

import "gorm.io/gorm"

type User struct {
	gorm.Model
	Name  string `gorm:"column:name;not null"`
	Email string `gorm:"column:email;uniqueIndex"`
	Role  string `gorm:"column:role"`
}
