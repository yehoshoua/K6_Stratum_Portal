package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"k6-bedrock-dashboard/backend/internal/database"

	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.MapClaims
}

type AuthService struct {
	jwtSecret []byte
	db        *database.DB
}

func NewAuthService(jwtSecret []byte, db *database.DB) *AuthService {
	return &AuthService{jwtSecret: jwtSecret, db: db}
}

// HashPassword hashes a password with a given salt
func HashPassword(password, salt string) string {
	hasher := sha256.New()
	hasher.Write([]byte(password + salt))
	return hex.EncodeToString(hasher.Sum(nil))
}

// GenerateSalt creates a cryptographically secure random salt string
func GenerateSalt() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// LoginLocal validates local username/password against SQLite database and returns a JWT token if valid
func (s *AuthService) LoginLocal(username, password string) (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}

	user, err := s.db.GetUser(username)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", errors.New("invalid credentials")
	}

	computedHash := HashPassword(password, user.Salt)
	if computedHash != user.PasswordHash {
		return "", errors.New("invalid credentials")
	}

	return s.GenerateToken(user.Username, user.Role)
}

// GenerateToken generates a JWT token valid for 24 hours
func (s *AuthService) GenerateToken(username, role string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"username": username,
		"role":     role,
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	})

	tokenString, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

// ValidateToken parses and validates a JWT token
func (s *AuthService) ValidateToken(tokenStr string) (string, string, error) {
	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return "", "", fmt.Errorf("invalid token: %w", err)
	}

	if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
		username, _ := claims["username"].(string)
		role, _ := claims["role"].(string)
		return username, role, nil
	}

	return "", "", errors.New("invalid claims")
}

// HandleSSOCallback processes a mock SSO authentication and returns a token
func (s *AuthService) HandleSSOCallback(ssoUser string, email string) (string, error) {
	// Map SSO logins to appropriate roles
	role := "viewer"
	ssoUserLower := strings.ToLower(ssoUser)
	emailLower := strings.ToLower(email)
	if ssoUser == "sso-admin" || strings.Contains(ssoUserLower, "admin") || strings.Contains(emailLower, "admin") || strings.Contains(ssoUserLower, "infra-ext-users") || strings.Contains(emailLower, "infra-ext-users") {
		role = "administrator"
	} else if strings.Contains(ssoUserLower, "editor") || strings.Contains(emailLower, "editor") || strings.Contains(ssoUserLower, "technical") || strings.Contains(emailLower, "technical") {
		role = "editor"
	}
	return s.GenerateToken(ssoUser, role)
}

