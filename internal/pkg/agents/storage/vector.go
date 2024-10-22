package storage

import (
	"context"
	"log/slog"
	"strconv"
	"strings"

	milvusClient "github.com/milvus-io/milvus-sdk-go/v2/client"
	"github.com/milvus-io/milvus-sdk-go/v2/entity"
	"github.com/roackb2/lucid/config"
)

var (
	collectionName = "posts"
)

type VectorStorage struct {
	client milvusClient.Client
}

func NewVectorStorage() (*VectorStorage, error) {
	address := config.Config.Milvus.Address
	slog.Info("VectorStorage: Connecting to Milvus", "address", address)
	client, err := milvusClient.NewGrpcClient(context.Background(), address)
	if err != nil {
		slog.Error("VectorStorage: Failed to connect to Milvus", "error", err)
		return nil, err
	}
	vectorStorage := &VectorStorage{client: client}

	err = vectorStorage.initialize()
	if err != nil {
		slog.Error("VectorStorage: Failed to initialize", "error", err)
		return nil, err
	}

	return vectorStorage, nil
}

func (v *VectorStorage) initialize() error {
	collections, err := v.client.ListCollections(context.Background())
	if err != nil {
		slog.Error("VectorStorage: Failed to list collections", "error", err)
		return err
	}
	slog.Info("VectorStorage: Collections", "collections", collections)

	collectionExists := false
	for _, collection := range collections {
		if collection.Name == collectionName {
			collectionExists = true
			break
		}
	}

	if !collectionExists {
		err = v.createPostsCollection()
		if err != nil {
			slog.Error("VectorStorage: Failed to create posts collection", "error", err)
			return err
		}
	}

	indexInfo, err := v.client.DescribeIndex(
		context.Background(),
		collectionName,
		"embedding",
	)
	if err != nil {
		errStr := err.Error()
		if strings.Contains(errStr, "index not found") {
			err = v.createPostsCollectionIndex()
			if err != nil {
				slog.Error("VectorStorage: Failed to create posts collection index", "error", err)
				return err
			}
		} else {
			slog.Error("VectorStorage: Failed to describe index", "error", err)
			return err
		}
	}
	slog.Info("VectorStorage: Index", "index", indexInfo)
	return nil
}

func (v *VectorStorage) createPostsCollectionIndex() error {
	idx, err := entity.NewIndexIvfFlat(
		entity.L2,
		config.Config.Milvus.Dimension,
	)
	if err != nil {
		slog.Error("VectorStorage: Failed to create ivf flat index", "error", err)
		return err
	}
	err = v.client.CreateIndex(
		context.Background(),
		collectionName,
		"embedding",
		idx,
		false,
	)
	if err != nil {
		slog.Error("VectorStorage: Failed to create index", "error", err)
		return err
	}
	return nil
}

func (v *VectorStorage) createPostsCollection() error {
	schema := &entity.Schema{
		CollectionName: collectionName,
		Description:    "Posts created by agents",
		Fields: []*entity.Field{
			{
				Name:       "id",
				DataType:   entity.FieldTypeInt64,
				PrimaryKey: true,
				AutoID:     true,
			},
			{
				Name:     "content",
				DataType: entity.FieldTypeVarChar,
				TypeParams: map[string]string{
					"max_length": "65535",
				},
				PrimaryKey: false,
				AutoID:     false,
			},
			{
				Name:     "embedding",
				DataType: entity.FieldTypeFloatVector,
				TypeParams: map[string]string{
					"dim": strconv.Itoa(config.Config.Milvus.Dimension),
				},
			},
		},
	}
	err := v.client.CreateCollection(
		context.Background(),
		schema,
		2,
	)
	if err != nil {
		return err
	}
	return nil
}

func (v *VectorStorage) ListCollections() error {
	return nil
}

func (v *VectorStorage) Save(content string) error {
	slog.Info("VectorStorage: Saving content", "content", content)
	return nil
}

func (v *VectorStorage) Search(query string) ([]string, error) {
	slog.Info("VectorStorage: Searching for content", "query", query)
	return nil, nil
}
