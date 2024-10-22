package storage

import (
	milvus "github.com/milvus-io/milvus-sdk-go/v2/client"
)

type VectorStorage struct {
	client *milvus.Client
}

func NewVectorStorage() *VectorStorage {
	return &VectorStorage{}
}

func (v *VectorStorage) Save(content string) error {
	return nil
}

func (v *VectorStorage) Search(query string) ([]string, error) {
	return nil, nil
}
