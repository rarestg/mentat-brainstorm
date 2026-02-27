# Signals

What signals we can realistically use to analyze the code base.

- Git + Github CLI to inspect codebase
- Observability MCP - Sentry, Posthog, others, etc.
- Review the code in repo and check for the setup.
    - Is the environment setup to run autonomous jobs in cloud - hermit, etc.
    - Is CI setup, where does it run - blacksmith, github actions, etc.
    - Is AI Code review setup.
    - Is Telemetry set up properly for agents to pick out issues and automatically fix them (loggingsucks.com)
- We can also interview the user using AskUserQuestionTool to gather more insights .
    - Where are bugs reported?
    - Where are tasks / projects tracked? - Jira, Linear, Notion, etc.
        - Allows us to identify how much automation can be done based on the tools used.
    - Where are plans (design docs) created and shared?