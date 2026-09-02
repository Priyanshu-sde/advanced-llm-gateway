# System Design & Decisions

## 1. What We Built
This is an advanced LLM gateway that sits between users and LLM providers like Groq and OpenRouter.

It controls and manages requests using PostgreSQL to track budgets and usage. It can route requests to different models based on the prompt size, automatically switch to another model if one fails, and record detailed usage information for every request.

## 2. Request Lifecycle & Moving Parts
### Request Flow

The complete flow is:

**Client → Gateway → Budget Check → Provider → Usage Logging → Response**

1. **Client:** The client sends a `POST /chat` request with an API key.

2. **Gateway:** The gateway validates the key, identifies the model, and estimates the maximum possible cost of the request.

3. **Budget Check:** The gateway checks the user's remaining budget in PostgreSQL. If enough budget is available, it temporarily reserves that amount before making the provider call.

4. **Provider Call:** The gateway sends the request to the selected LLM provider. If the provider temporarily fails or times out, the gateway retries or falls back to another model.

5. **Provider Response:** The provider returns the generated response along with the actual token usage.

6. **Usage Logging:** The gateway calculates the exact cost using the actual token count. It removes the temporary reservation and records the final usage in PostgreSQL.

7. **Response:** Finally, the gateway sends the LLM response back to the client.

**In short:** the gateway first makes sure the request is affordable, then calls the LLM, records the actual cost, and returns the response.


## 3. Most Important Decisions

1. **Stack: TypeScript, Node.js, Fastify**
   - **Options**: Python/FastAPI, Go.
   - **Picked**: Node.js + Fastify.
   - **Tradeoff**: I lose out on Python's dense AI tooling ecosystem, but Node's event loop is highly optimal for this I/O-bound proxy workload, and Fastify has incredibly low overhead compared to Express.

2. **Datastore: PostgreSQL with raw `pg` queries**
   - **Options**: MongoDB, PostgreSQL + Prisma/ORM, Redis.
   - **Picked**: PostgreSQL with raw SQL.
   - **Tradeoff**: developer velocity of an ORM may be fast. However, we gain the ability to write hyper-optimized, load-bearing conditional `UPDATE` statements using Common Table Expressions (CTEs) to ensure lock-free, race-free budget enforcement.

3. **Execution Model: Non-streaming**
   - **Options**: Streaming (SSE) vs Non-streaming.
   - **Picked**: Non-streaming.
   - **Tradeoff**: It severely degrade Time-To-First-Token (TTFT) and the user experience for interactive chat. In exchange, we guarantee exact budget settlement and fallback correctness (if a model fails mid-stream, you cannot un-send chunks to the user).

4. **Budget Unit: Currency (integer nano-USD)**
   - **Options**: Token counts vs Float USD vs Integer nano-USD.
   - **Picked**: Integer nano-USD.
   - **Tradeoff**: We have to locally vendor and update static pricing tables. However, this is the only way to unify budgets across disparate models with vastly different token prices, and integer math prevents floating-point rounding errors from compounding.
## 4. Why enforce budgets at the gateway?

We enforce budgets at the gateway because we cannot trust clients to report their own usage.

A client could be buggy or malicious and report incorrect usage, which could result in unexpected costs.

Also, multiple clients may use the same API key at the same time. If each client checks the budget independently, they could all spend money before their usage is synchronized.

The gateway solves this by acting as a central checkpoint. It checks and reserves the budget **before sending the request to the LLM provider**.

---

## 5. Concurrency & Nearly Exhausted Keys

We handle concurrent requests using PostgreSQL's atomic updates and row-level locking.

For example, if two requests arrive at the same time and only a small amount of budget is left, the database processes the budget update safely.

The first request reserves the available budget.

When the second request checks the condition, it sees that there isn't enough budget remaining, so the update fails and the gateway rejects the request with a `402 Payment Required`.

This prevents two simultaneous requests from spending more than the available budget.

---

## 6. Fallback Policy

Our fallback strategy is:

**Classify → Retry once → Fail over**

First, we check what type of error occurred.

* Temporary errors like timeouts, network failures, or `429` rate limits are retried once.
* We use exponential backoff with random jitter to avoid sending retries at exactly the same time.
* Permanent errors, such as `400 Bad Request` or authentication failures, are not retried.

If the retry also fails, the gateway switches to a fallback model.

---

## 7. What We Did Not Build: Caching

We intentionally did not implement caching.

Exact caching is not very useful for chat because even small changes in a prompt can produce a different request.

Semantic caching is more complicated. It would require generating embeddings and searching a vector database for similar prompts.

For this project, that would add extra latency, infrastructure, and cost to every request.

So we decided that caching was not worth the added complexity for this gateway.
## 8. The Decision I'm Least Confident About: Routing Policy

The decision I'm least confident about is using **prompt length to choose the model**.

The advantage is that it's very simple and fast. It adds almost no latency or cost. For example, large RAG prompts can be sent to a larger model, while short and simple requests can use a smaller, cheaper model.

However, the downside is that prompt length doesn't always represent difficulty.

For example, a 5,000-token prompt could be a simple summarization task that a small model can handle. On the other hand, a 50-token prompt could contain a difficult coding or reasoning problem that needs a larger model.

So, length-based routing is a good simple starting point, but it isn't perfect.

---

## 9. Where It Breaks & What I'd Do With One More Week

One important failure case is **provider connection timeouts**.

Imagine the provider successfully processes the request and charges us, but the connection breaks before our gateway receives the response.

In that case, the provider has charged us, but our database doesn't record the usage. Over time, this can cause a difference between our internal spending records and the actual provider bill.

If I had one more week, I would add a **background reconciliation worker**.

It would regularly compare our internal usage records with the provider's billing data and correct any differences.

I would also build a simple **admin dashboard** where we could create API keys and monitor spending.
