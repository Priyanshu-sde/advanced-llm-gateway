# AI Log

This document details the step-by-step process of how Artificial Intelligence tools and agents were utilized to build, debug, and deploy this project.

## 1. Initial Planning & Architecture
* **Tool Used:** Claude Sonnet
* **Process:** Copy-pasted the initial project requirements and goals into Claude Sonnet to gauge the overall complexity of the project and gather insights on industry best practices for the architecture.

## 2. Core Code Generation
* **Tools Used:** Claude Opus (via OpenCode terminal)
* **Process:** After initializing the project manually, a comprehensive prompt was generated using Sonnet to build the core functionality. This prompt was then executed in the OpenCode terminal using the Opus model to generate the foundational codebase.

## 3. Code Review & Refactoring
* **Tool Used:** Antigravity IDE
* **Process:** Opened the generated code in the Antigravity IDE. Conducted a manual review to remove unnecessary, over-engineered code, simplifying the logic for better maintainability.

## 4. Debugging & Issue Resolution
* **Tool Used:** Antigravity AI Agent
* **Process:** During initial test runs, the application crashed multiple times. The error logs were pasted into the Antigravity agent chat for debugging. Several architectural and coding decisions made by Claude were questioned, and the Antigravity agent was used to verify whether those decisions adhered to best practices.

## 5. Deployment & Configuration
* **Tools Used:** AI for Nginx & `curl` commands
* **Process:** Deployed the code on a Virtual Machine. Most of the deployment process was handled manually based on prior knowledge, but AI was leveraged to assist with refining the Nginx configuration file. Additionally, AI was used to generate `curl` commands to thoroughly test the deployed API routes.

## 6. Frontend Development
* **Tool Used:** Antigravity AI Agent
* **Process:** Prompted the Antigravity agent to build out the frontend application utilizing plain HTML, CSS, and Vanilla JavaScript.

## 7. Feature Iteration & Routing
* **Tool Used:** Antigravity AI Agent
* **Process:** Discussed the potential implementation of Semantic Caching with the AI. After analyzing the trade-offs (increased complexity, higher latency, and additional costs), the decision was made to discard the caching idea. Instead, the focus shifted to implementing request routing using Antigravity.

## 8. Documentation
* **Tool Used:** Antigravity AI Agent
* **Process:** Authored the `DECISIONS.md` document manually and then used AI to enhance, format, and refine the explanations of the architectural decisions made throughout the project lifecycle. 

After these steps, the finalized codebase and documentation were pushed to the repository.
