# The Cycle

There are 5 core areas where companies will have bottle necks:

1. Plans
2. Code
3. Review
4. Test
5. Deploy

Some are easy to solve, others are hard.

## Plans

Companies have been using design docs for ever, but with the help of coding agents, companies can increase the throughput of plans produced. 

Plans can be easily converted into code, so it is essential for a company to build a culture that incentivizes people to take initiatives to create plans.

Here are a few practical ways to do it.

- Encourage people to use coding agents to come up with product improvement plans.
- Ask employees to install Claude Code on Phone so they can ship plans from anywhere.
- Create a company culture that rewards people who put out good plans (this increases initiative culture, and leads to culture transformation of the org)
- Create a system to track the plans shared by employees. Make it easy to collaborate on Plans.

With right incentive structure, companies can get the most out of their engineering hires. They can tap into the creative energy of the smartest people, and attract other smart people to join, which can kick off a flywheel of great engineering culture for the company. 

Just plans won’t help. Employees also need to be able to experiment and get them deployed, otherwise the culture will deteriorate quickly. There has to be a way for plans to push through the pipeline. 

Besides humans, we can also set up automations for agents to create plans. Agents can be put on a cron to scan bug reports and create plans to fix them. The important system to develop here is database for agents to scan the active issues in the system. The best is error logs in Sentry, Filed Github Issues, or reported bugs from customers in Zendesk or Notion.

Agents can also create plan on events. Event based agent automations can become expensive quite fast. The best solution is to create plans for high priority incidents. Hooking up agents to plan a resolution to a platform like Rootly, or PagerDuty is economically feasible. Ideally, alerts are categorized, so incidents that will loose revenue are resolved right away. 

## Code

Writing code isn’t the bottleneck and output of good quality code still can be companies even if they have adopted coding agents.

The bottle neck usually is engineering team. If your engineers are the ones babysitting the coding agents, the bottleneck is still the size of engineering team. The best way to tackle this bottleneck is to create systems that allow everyone to ship PRs.

Potential solutions

- Allow everyone to ship code
- Create platform that allows anyone to create PRs using background coding agents.
- Easiest solution is to set up claude code in web for all employees.

Issues

- People clutter github with low quality PRs.
- Becomes hard to ship because its not easy to review, test, and deploy all changes safely. To solve this, we need to reduce bottleneck from the last three phases.

## Review

- AI code review is a commodity, just pick any code review bot to get started
- The review will still be a bottleneck, because humans will do final review.
- To fully automate review, one has to develop intensive testing infra.
- Another way to automate review is continuously build a staging env and extensive run tests on it periodically. Changes that break are then flagged for review.

## Tests

Automating Tests is vastly different for each code base.

The cool thing about agents with computers is that almost all types of tests can be done via machines now. 

The work is needed to set up environments that allow agents to perform tests that humans do and automate it. 

- Revyl, Spur, etc allow you to automate tests on websites
- Cursor cloud agents are able to create test for you in cloud after writing code.

The question here is mostly cost benefit analysis. 

Not all companies can afford computer-use agents, the solution depends on what’s right for the company.

## Deployments

Automated deployments are already a thing. There are enough tools big companies have that deploy code of 1000s of engineers at scale and allow for rollbacks. This is hardest for small teams to set up but big corps should already have mechanisms to take Merged PRs and deploy it automatically with rollback functionality