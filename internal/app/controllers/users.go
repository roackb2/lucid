package controllers

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/roackb2/lucid/internal/pkg/dbaccess"
	"golang.org/x/crypto/bcrypt"
)

type UserRequest struct {
	Username string `json:"username" binding:"required"`
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

// CreateMockUser godoc
//	@Summary		Create a new user
//	@Description	Creates a new user with the provided details
//	@Tags			users
//	@Accept			json
//	@Produce		json
//	@Param			user	body		UserRequest			true	"User details"
//	@Success		201		{object}	map[string]string	"User created successfully"
//	@Failure		400		{object}	map[string]string	"Bad request"
//	@Failure		500		{object}	map[string]string	"Internal server error"
//	@Router			/api/v1/users [post]
func CreateMockUser(c *gin.Context) {
	var user UserRequest
	if err := c.ShouldBindJSON(&user); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Hash the password using bcrypt
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	createUserRes := dbaccess.CreateUserParams{
		Username:     user.Username,
		Email:        user.Email,
		PasswordHash: string(hashedPassword),
	}

	err = dbaccess.Querier.CreateUser(context.Background(), createUserRes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "User created successfully"})
}
