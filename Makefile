# Build all executables in the cmd folder
build:
	@for dir in cmd/*; do \
		if [ -d "$$dir" ]; then \
			app_name=$$(basename "$$dir"); \
			echo "Building $$app_name..."; \
			go build -o bin/$$app_name ./cmd/$$app_name; \
		fi \
	done

# Generate run targets for each executable
define generate_run_target
$(1): generate-db-models swagger build
	./bin/$(1) $(ARGS)
endef

# Find all executables in the bin folder and create run targets
EXECUTABLES := $(notdir $(wildcard bin/*))
$(foreach exec,$(EXECUTABLES),$(eval $(call generate_run_target,$(exec))))

# Clean up build artifacts
clean:
	rm -f bin/*

# Build Swagger documentation
swagger:
	@echo "Current directory: $$(pwd)"
	@echo "Generating Swagger documentation..."
	@which swag > /dev/null || (echo "swag not found. Installing..." && go install github.com/swaggo/swag/cmd/swag@latest)
	@echo "Running swag init..."
	@swag init -g main.go -d ./cmd/server,./internal/app/controllers -o api/swagger

.PHONY: build clean swagger $(addprefix run-,$(EXECUTABLES))

generate-db-models:
	@echo "Generating database models..."
	@sqlc generate -f db/sqlc.yml

# Run migrations up
migrate-up: build
	./bin/migrate -up -dump

# Run migrations down
migrate-down: build
	./bin/migrate -down -dump

run-server: generate-db-models swagger build
	./bin/server
