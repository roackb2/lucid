package utils_test

import (
	"testing"

	"github.com/roackb2/lucid/internal/pkg/utils"
	"github.com/stretchr/testify/assert"
)

func TestGetOrDefault(t *testing.T) {
	assert.Equal(t, 1, utils.GetOrDefault(1, 2))
	assert.Equal(t, 2, utils.GetOrDefault(0, 2))
}
