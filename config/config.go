package config

import (
	"log"

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
}

func init() {
	viper.SetConfigName("dev")    // name of config file (without extension)
	viper.SetConfigType("yaml")   // required if config file doesn't have an extension
	viper.AddConfigPath("config") // look for config in the working directory

	viper.AutomaticEnv() // override config file with environment variables

	if err := viper.ReadInConfig(); err != nil {
		log.Fatalf("Error reading config file: %s", err)
	}

	if err := viper.Unmarshal(&Config); err != nil {
		log.Fatalf("Unable to decode into struct: %s", err)
	}

	log.Println("Configuration loaded successfully")
}
