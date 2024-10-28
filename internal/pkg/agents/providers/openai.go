package providers

import "github.com/openai/openai-go"

type OpenAIChatProvider struct {
	Client *openai.Client
}

func (p *OpenAIChatProvider) Chat() (ChatResponse, error) {
	return ChatResponse{}, nil
}
