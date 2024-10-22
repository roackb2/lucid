package embedding

import (
	"context"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/shared"
	"github.com/roackb2/lucid/config"
)

func Embed(text string) ([]openai.Embedding, error) {
	client := openai.NewClient(
		option.WithAPIKey(config.Config.OpenAI.APIKey),
	)
	resp, err := client.Embeddings.New(context.TODO(), openai.EmbeddingNewParams{
		Input:          openai.F[openai.EmbeddingNewParamsInputUnion](shared.UnionString(text)),
		Model:          openai.F(openai.EmbeddingModelTextEmbedding3Small),
		EncodingFormat: openai.F(openai.EmbeddingNewParamsEncodingFormatFloat),
	})
	if err != nil {
		return nil, err
	}
	return resp.Data, nil
}

func ConvertToFloat32(embeddings []openai.Embedding) [][]float32 {
	embeddingsFloat := make([][]float32, len(embeddings))
	for i, embedding := range embeddings {
		for _, f := range embedding.Embedding {
			embeddingsFloat[i] = append(embeddingsFloat[i], float32(f))
		}
	}
	return embeddingsFloat
}
