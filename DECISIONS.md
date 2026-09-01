
# Decisions

A concise summary of key architectural choices and their trade-offs(enahanced with AI).

---

## 1. Stack → **TypeScript + Node 24 + Fastify**
- **Why**: Node's event loop is excellent for this I/O-bound workload. Fastify provides built-in schema validation and low overhead than express and I am also comfortable with node and typescript.

## 2. Streaming vs Non-streaming → **Non-streaming**
- **Why**: It ensures **budget correctness** (because the full response will contain exact token count) and **fallback correctness** (cannot un-send chunks if a current model fails mid-stream and it has fallen back to other model).
- **Cost**: Worse perceived latency, unsuitable for interactive chat UIs.


## 3. Datastore → **PostgreSQL, no ORM**
- **Why**: Postgres provides a single source of truth and race-free admission checks for budget enforcement. Raw `pg` was chosen over Prisma to optimize load-bearing conditional `UPDATE` queries without ORM abstraction penalties.
- **Cost**: Requires manually writing type interfaces for query results.

## 4. Budget Unit → **Currency (integer nano-USD)**
- **Why**: Any smally rounding error can become huge in production. Currency is the only metric comparable across different models. Float math errors are avoided by using `BIGINT` nano-USD.
- **Mechanics**: Cost is estimated and atomically **reserved pre-call**, then reconciled against provider usage **post-call**. Budget exhaustion returns `402 Payment Required`, not `429`.

## 5. Caching → **None**
- **Why**: Deliberately omitted because semantic caching was more latency in chat response (calling a vector embidding model the searching the db for cosine similarity). 


## 6. Host → **Single VM + NGNIX**
- **Why**: NGNIX handles automatic Let's Encrypt TLS cleanly. Always on VM ensures high availability and fast response time while render was taking 2-3 mins to wake up.

## 7. Routing Policy → **Length-based heuristic for 'auto' model**
- **Why**: A true classification step using an LLM adds unacceptable latency and cost to every request. Using a local, deterministic heuristic (like input token count) achieves cheap-vs-capable dispatch with zero overhead.
- **Mechanics**: Requests over 1000 input tokens (e.g., RAG context, large documents) are routed to the capable 120b model, while shorter requests (chat, simple questions) are routed to the cheap 20b model.

## 8. Provider Schema → **OpenAI Chat Completions**
- **Why**: Broad compatibility ensures standard SDKs work with just a base URL change.
- **Constraint**: Unknown parameters are strictly rejected (400) rather than forwarded to guarantee that budget estimations match the request parameters.

## 9. Fallback Policy → **Classify, Retry once, Fail over**
- **Why**: Blind retries waste latency. Transient errors (timeouts, network issues, 429s) get **one retry**. Deterministic errors (400, auth, policy) **immediately fail or abort**.
- **Mechanics**: Chains degrade from capable → cheap → free (mock) models.


---

## Known Limitations

1. **Lifetime Budgets**: Budgets are lifetime caps, not windowed (e.g., no daily/monthly reset).
2. **Static Pricing**: The pricing table is vendored locally and will drift from upstream changes.
3. **Untracked Spend**: If the provider generates tokens but the connection times out before returning, the spend is invisible to our ledger.
4. **Rate Limiting**: No per-key rate limiting, only budget-based.
