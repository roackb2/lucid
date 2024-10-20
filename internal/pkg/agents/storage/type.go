package storage

type Storage interface {
	Save(content string) error
	Search(query string) ([]string, error)
}
