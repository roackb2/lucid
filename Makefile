# Build the application
build:
	go build -o bin/lucid ./cmd/lucid.go

# Run the application
run: build
	./bin/lucid

# Clean up build artifacts
clean:
	rm -f bin/lucid

.PHONY: build run clean
