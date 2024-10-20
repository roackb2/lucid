package agents

type Agent interface {
	StartTask(ch chan string)
}
