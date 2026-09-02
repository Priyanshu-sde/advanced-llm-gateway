# AI Log

This document details how Artificial Intelligence tools and agents were utilized to build, debug, and deploy this project.

## Which AI tools/models you used, and for what
* **Claude Sonnet:** Used for initial planning, architecture design, and generating comprehensive prompts to gauge project complexity.
* **Claude Opus:** Used via OpenCode terminal for the initial core code generation based on the prompts.
* **Antigravity IDE (Gemini Models):** Used extensively for code review, refactoring over-engineered code, debugging error logs, frontend development, feature iteration, and documentation generation.
* **AI (General):** Assisted with refining the Nginx configuration file for deployment and generating `curl` commands to thoroughly test the deployed API routes.

## One place the AI was wrong or misleading, and how you caught it
* AI suggested to deploy on render and it take 5 min cold start time but I went for VM approach and installed nginx and pm2 manually. AI suggested that sematic caching is easy but it was not.
* **How it was caught:** I concluded that it would be better to have a custom setup to avoid cold start times and have more control over the application.

## One place you overrode the AI's suggestion, and why
* **Scenario:** During feature iteration, the AI and I discussed implementing Semantic Caching to reduce costs and latency.
* **Why it was overridden:** After analyzing the trade-offs (increased architectural complexity, higher latency on cache misses, and additional operational costs), I decided to override the suggestion, discard the caching idea, and focus strictly on request routing. 

## How you stayed in control of code you didn't type by hand
* First I reviewed all the code myself. I used the Antigravity IDE to question the AI's architectural decisions, stripped out unnecessary over-engineered logic to keep the codebase maintainable, and manually tested the core flows using `curl` to ensure the outputs were exactly as expected. 

* **Secrets & Provider Calls:** I manually reviewed the implementation in `src/routes/chat.ts` and `src/chain.ts` to ensure that API keys and provider logic (like OpenRouter integrations) were handled securely, strictly validated in the headers, and not hardcoded.
* **Budget Logic:** For the critical `reserve` and `settle` financial logic, I walked through the code line by line to verify the arithmetic and database transactions matched my exact specifications. The budget enforcement required bounding a request's cost before forwarding it, which I explicitly enforced.

## Something you had to learn from scratch this weekend, and how you got up to speed
* **Topic:** Althogh I have used open ai compactable api before but going into the depth of it and implemting it myselft was a new experience.
* **How I got up to speed:** Every thing i asked from AI.
