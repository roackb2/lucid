package storage

type Storage interface {
	Save(content string)
	Search(query string) []string
}
