package config

import (
	"log/slog"
	"time"

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
	Worker struct {
		TickerInterval      time.Duration `mapstructure:"ticker_interval"`
		WorkerControlChSize int           `mapstructure:"worker_control_ch_size"`
		PublishTimeout      time.Duration `mapstructure:"publish_timeout"`
	} `mapstructure:"worker"`
	AgentController struct {
		AgentLifeTime time.Duration `mapstructure:"agent_life_time"`
		ScanInterval  time.Duration `mapstructure:"scan_interval"`
		MaxRespChSize int           `mapstructure:"max_resp_ch_size"`
	} `mapstructure:"agent_controller"`
	Scheduler struct {
		SchedulerControlChSize int           `mapstructure:"scheduler_control_ch_size"`
		ScanInterval           time.Duration `mapstructure:"scan_interval"`
		AgentSleepDuration     time.Duration `mapstructure:"agent_sleep_duration"`
		AgentAwakeDuration     time.Duration `mapstructure:"agent_awake_duration"`
		BatchProcessAgentNum   int           `mapstructure:"batch_process_agent_num"`
	} `mapstructure:"scheduler"`
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
