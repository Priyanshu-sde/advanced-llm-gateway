# Advanced LLM Gateway

A robust, budget-aware, multi-provider LLM gateway.

## Running the Project

To start the gateway locally, ensure you have the required `.env` file and PostgreSQL database set up, then run:

```bash
pnpm install
pnpm run build
pnpm start
```

## API Usage

The gateway provides an OpenAI-compatible endpoint for chat completions. It supports standard parameters but explicitly does not support streaming (due to budget enforcement constraints).

### Authentication

All protected API requests require an `Authorization` header with a valid API key (e.g., `gw_live_...`):

```http
Authorization: Bearer <your_api_key>
```

### Create Chat Completion

**Endpoint:** `POST /v1/chat/completions`

**Supported Parameters:**
- `model` (string, required): The name of the model to use.
- `messages` (array, required): Array of message objects with `role` (`system`, `user`, `assistant`) and `content`.
- `max_tokens` (integer, optional): Maximum number of tokens to generate.
- `temperature` (number, optional): Sampling temperature between 0 and 2.
- `top_p` (number, optional): Nucleus sampling parameter between 0 and 1.
- `stop` (string | array, optional): Sequences where the API will stop generating further tokens.

*Note: `stream: true` is not supported on this gateway.*

#### Example `curl` Request

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_live_your_api_key_here" \
  -d '{
    "model": "llama-3-8b-instruct",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "What is the capital of France?"
      }
    ],
    "max_tokens": 150,
    "temperature": 0.7
  }'
```

#### Example `auto` Routing Request

The gateway supports an `auto` model which intelligently routes your request to a different model tier based on the estimated input token size.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gw_live_your_api_key_here" \
  -d '{
    "model": "auto",
    "messages": [
      {
        "role": "user",
        "content": "Analyze the following large dataset..."
      }
    ]
  }'
```

#### Example Response

The response includes standard OpenAI fields as well as custom headers and an `x_gateway` object with usage, budget, and routing information.

```json
{
  "id": "chatcmpl-a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
  "object": "chat.completion",
  "created": 1690000000,
  "model": "llama-3-8b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The capital of France is Paris."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 7,
    "total_tokens": 27
  },
  "x_gateway": {
    "request_id": "a1b2c3d4-e5f6-7g8h-9i0j-k1l2m3n4o5p6",
    "served_by": "groq:llama3-8b-8192",
    "attempts": [
      {
        "provider": "groq",
        "model": "llama3-8b-8192",
        "status": 200,
        "error_class": null,
        "latency_ms": 350
      }
    ],
    "usage_source": "provider_response",
    "cost_usd": "0.000100",
    "key_spent_usd": "1.500000",
    "key_budget_usd": "10.000000"
  }
}
```

### Health and Readiness Endpoints

- **GET `/health`**: Returns the health status, supported models, and configured providers.
  ```bash
  curl http://localhost:3000/health
  ```
- **GET `/ready`**: Returns whether the application (and its database connection) is ready to accept traffic.
  ```bash
  curl http://localhost:3000/ready
  ```

### UI Routes
- **Dashboard UI**: `GET /dashboard`
- **Chat UI**: `GET /chat`



