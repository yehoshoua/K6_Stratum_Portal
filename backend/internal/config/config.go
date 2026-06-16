package config

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
)

type Config struct {
	Port             string
	EncryptionKey    []byte
	JWTSecret        []byte
	InfluxURL        string
	InfluxToken      string
	InfluxOrg        string
	InfluxBucket     string
	DBType           string
	DBDSN            string
}

func LoadConfig() (*Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	encKeyStr := os.Getenv("ENCRYPTION_KEY")
	if encKeyStr == "" {
		// Provide a default key for development/demo (32 bytes for AES-256)
		encKeyStr = "dGhpcy1pcy1hLTMyLWJ5dGUtZGV2ZWxvcG1lbnQta2V5MSE=" // "this-is-a-32-byte-development-key1!" base64 encoded
	}
	encKey, err := base64.StdEncoding.DecodeString(encKeyStr)
	if err != nil || len(encKey) != 32 {
		// fallback to raw string if it's 32 bytes or generate a random one
		if len(encKeyStr) == 32 {
			encKey = []byte(encKeyStr)
		} else {
			// Generate fallback key for dev
			encKey = []byte("dev-key-must-be-exactly-32bytes!")
		}
	}

	jwtSecretStr := os.Getenv("JWT_SECRET")
	if jwtSecretStr == "" {
		jwtSecretStr = "super-secret-jwt-signing-key-for-k6-bedrock-dashboard"
	}

	dbType := os.Getenv("DB_TYPE")
	if dbType == "" {
		dbType = "sqlite"
	}
	dbDSN := os.Getenv("DATABASE_URL")

	return &Config{
		Port:             port,
		EncryptionKey:    encKey,
		JWTSecret:        []byte(jwtSecretStr),
		InfluxURL:        os.Getenv("INFLUXDB_URL"),
		InfluxToken:      os.Getenv("INFLUXDB_TOKEN"),
		InfluxOrg:        os.Getenv("INFLUXDB_ORG"),
		InfluxBucket:     os.Getenv("INFLUXDB_BUCKET"),
		DBType:           dbType,
		DBDSN:            dbDSN,
	}, nil
}

// Encrypt encrypts plain text using AES-256-GCM with the configured key
func (c *Config) Encrypt(plainText []byte) (string, error) {
	block, err := aes.NewCipher(c.EncryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	cipherText := gcm.Seal(nonce, nonce, plainText, nil)
	return base64.StdEncoding.EncodeToString(cipherText), nil
}

// Decrypt decrypts AES-256-GCM cipher text
func (c *Config) Decrypt(cipherTextStr string) ([]byte, error) {
	cipherText, err := base64.StdEncoding.DecodeString(cipherTextStr)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(c.EncryptionKey)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(cipherText) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, actualCipherText := cipherText[:nonceSize], cipherText[nonceSize:]
	plainText, err := gcm.Open(nil, nonce, actualCipherText, nil)
	if err != nil {
		return nil, err
	}

	return plainText, nil
}
