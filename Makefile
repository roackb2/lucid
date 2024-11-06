milvus-url = milvus-standalone.orb.local:19530

# ================================
# Build
# ================================

# Recursively find all Go files in cmd and its subfolders
GO_FILES := $(shell find cmd -name '*.go')

# Extract unique directory names from GO_FILES
CMD_DIRS := $(sort $(dir $(GO_FILES)))

# Build all executables in the cmd folder and its subfolders
build:
	@for dir in $(CMD_DIRS); do \
		app_name=$$(echo $$dir | sed 's|cmd/||g' | sed 's|/$$||' | tr '/' '_'); \
		echo "Building $$app_name..."; \
		go build -o bin/$$app_name ./$$dir; \
	done

# ================================
# Examples
# ================================

# Recursively find all Go files in the examples folder
EXAMPLE_GO_FILES := $(shell find examples -name '*.go')

# Extract unique directory names from EXAMPLE_GO_FILES
EXAMPLE_DIRS := $(patsubst examples/%,%,$(patsubst %/,%,$(sort $(dir $(EXAMPLE_GO_FILES)))))

# Generate run targets for each executable in the examples folder
define generate_example_target
example_$(subst /,_,$(1)):
	@echo "Building and running example $(1)..."
	@go build -o bin/$(subst /,_,$(1)) ./examples/$(1)
	@./bin/$(subst /,_,$(1))
endef

# Create targets for each directory in EXAMPLE_DIRS
$(foreach dir,$(EXAMPLE_DIRS),$(eval $(call generate_example_target,$(dir))))

# Debug target to list all available example targets
list-examples:
	@echo "Available example targets:"
	@for dir in $(EXAMPLE_DIRS); do \
		echo "  make example_$${dir//\//_}"; \
	done

.PHONY: list-examples $(foreach dir,$(EXAMPLE_DIRS),example_$(subst /,_,$(dir)))

test:
	go test ./internal/... -v

test-integration:
	go test ./test/integration/... -v

.PHONY: test test-integration

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
	@sqlc generate -f database/sqlc.yml

generate-mocks:
	mockgen -source internal/pkg/agents/storage/type.go -destination test/_mocks/storage/mock_type.go
	mockgen -source internal/pkg/agents/worker/type.go -destination test/_mocks/worker/mock_type.go
	mockgen -source internal/pkg/agents/providers/type.go -destination test/_mocks/providers/mock_type.go
	mockgen -source internal/pkg/agents/agent/type.go -destination test/_mocks/agent/mock_type.go
	mockgen -source internal/pkg/control_plane/type.go -destination test/_mocks/control_plane/mock_type.go
	mockgen -source internal/pkg/pubsub/type.go -destination test/_mocks/pubsub/mock_type.go

# Run migrations up
migrate-up: build
	./bin/migrate -up -dump

# Run migrations down
migrate-down: build
	./bin/migrate -down -dump

run-server:
	go build -o bin/server cmd/server/main.go
	@make swagger
	./bin/server

run-server-without-control-plane:
	go build -o bin/server cmd/server/main.go
	@make swagger
	./bin/server --with-control-plane=false

start-milvus:
	cd milvus && ./standalone_embed.sh start

stop-milvus:
	cd milvus && ./standalone_embed.sh stop

run-milvus-gui:
	docker run --rm -p 8000:3000 -e MILVUS_URL=${milvus-url} zilliz/attu:v2.4

start-kafka:
	cd kafka-stack-docker-compose && docker compose -f zk-single-kafka-single.yml up -d

stop-kafka:
	cd kafka-stack-docker-compose && docker compose -f zk-single-kafka-single.yml down
