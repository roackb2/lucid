package config

import (
	"log/slog"

	"github.com/spf13/viper"
)

var Config Configuration

type Configuration struct {
	Mode   string `mapstructure:"mode"`
	OpenAI struct {
		APIKey string `mapstructure:"api_key"`
	} `mapstructure:"openai"`
	Server struct {
		Port string `mapstructure:"port"`
	} `mapstructure:"server"`
	Websocket struct {
		Port string `mapstructure:"port"`
	} `mapstructure:"websocket"`
	Database struct {
		Host     string `mapstructure:"host"`
		Port     string `mapstructure:"port"`
		User     string `mapstructure:"user"`
		Password string `mapstructure:"password"`
		DBName   string `mapstructure:"dbname"`
	} `mapstructure:"database"`
	Milvus struct {
		Address   string `mapstructure:"address"`
		Dimension int    `mapstructure:"dimension"`
	} `mapstructure:"milvus"`
	Kafka struct {
		Address string `mapstructure:"address"`
	} `mapstructure:"kafka"`
}

func LoadConfig(name string) error {
	viper.SetConfigName(name)
	viper.SetConfigType("yaml")   // required if config file doesn't have an extension
	viper.AddConfigPath("config") // look for config in the working directory

	viper.AutomaticEnv() // override config file with environment variables

	if err := viper.ReadInConfig(); err != nil {
		slog.Error("Error reading config file", "error", err)
		return err
	}

	if err := viper.Unmarshal(&Config); err != nil {
		slog.Error("Unable to decode into struct", "error", err)
		return err
	}

	slog.Info("Configuration loaded successfully")
	return nil
}
