package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const passwordPrefix = "argon2id-v1:"

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	return passwordPrefix + base64.RawStdEncoding.EncodeToString(salt) + ":" + base64.RawStdEncoding.EncodeToString(hash), nil
}

func verifyPassword(encoded, password string) bool {
	if !strings.HasPrefix(encoded, passwordPrefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(encoded, passwordPrefix), ":")
	if len(parts) != 2 {
		return false
	}
	salt, saltErr := base64.RawStdEncoding.DecodeString(parts[0])
	expected, hashErr := base64.RawStdEncoding.DecodeString(parts[1])
	if saltErr != nil || hashErr != nil || len(salt) != 16 || len(expected) != 32 {
		return false
	}
	actual := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)
	return subtle.ConstantTimeCompare(actual, expected) == 1
}

func validateCredentials(username, password string) bool {
	if !utf8.ValidString(username) || !utf8.ValidString(password) {
		return false
	}
	usernameLength := utf8.RuneCountInString(strings.TrimSpace(username))
	passwordLength := utf8.RuneCountInString(password)
	return usernameLength >= 1 && usernameLength <= 40 && passwordLength >= 8 && passwordLength <= 15
}
