# Build all executables in the cmd folder
build:
	@for dir in cmd/*; do \
		if [ -d "$$dir" ]; then \
			app_name=$$(basename "$$dir"); \
			echo "Building $$app_name..."; \
			go build -o bin/$$app_name ./cmd/$$app_name; \
		fi \
	done

# Run the main application (assuming lucid is the main one)
run: build
	./bin/lucid

# Clean up build artifacts
clean:
	rm -f bin/*

# Build Swagger documentation
swagger:
	@echo "Generating Swagger documentation..."
	@which swag > /dev/null || (echo "swag not found. Installing..." && go install github.com/swaggo/swag/cmd/swag@latest)
	@swag init -g cmd/lucid/main.go -o api/swagger

.PHONY: build run clean swagger
