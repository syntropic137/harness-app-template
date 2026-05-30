# AI Is Forcing Us To Write Good Code

**Source:** https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false

AI Is Forcing Us To Write Good Code
When Best Practices Are Best
STEVE KRENZEL
DEC 29, 2025
2
5
Sh
For decades, we’ve all known what “good code” looks like. Thorough tests. Clear
documentation. Small, well-scoped modules. Static typing. Dev environments you c
spin up without a minor religious ritual.
These things were always optional, and time pressure usually meant optional got cut
Agents need these optional things though. They aren’t great at making a mess and
cleaning it up later. Agents will happily be the Roomba that rolls over dog poop and
drags it all over your house.
53
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
1/13
The only guardrails are the ones you set and enforce. If the agentic context is lackin
and the guardrails aren’t sufficient, you’ll find yourself in a world of pain 1. But if th
guardrails are solid, the LLM can bounce around tirelessly until the only path out is
the correct one.
Our six-person team has made a lot of specific and, sometimes, controversial
investments to accommodate our agentic coders. Let’s talk about some of the less
obvious ones.
The most controversial guideline we have is our most valuable: We require 100% co
coverage 2.
100% Percent Code Coverage
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
2/13
Everyone is skeptical when they hear this until they live with it for a day. It feels lik
secret weapon at times.
Coverage, as we use it, isn’t strictly about bug prevention; it’s about guaranteeing th
agent has double-checked the behavior of every line of code it wrote.
The usual misinterpretation is that people think we believe 100% coverage means “n
bugs”. Or that we’re chasing a metric, and metrics get gamed. Neither of those are t
case here.
Why 100%? At 95% coverage, you’re still making decisions about what’s “important
enough” to test. At 99.99%, you don’t know if that uncovered line in ./src/foo.ts was
there before you started work on the new feature. At 100%, there’s a phase change a
all of that ambiguity goes away 3. If a line isn’t covered, it’s because of something yo
actively just did.
The coverage report becomes a simple todo list of tests you still need to write. It’s a
one less degree of freedom we have to give to the agent to reason about.
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
3/13
At 100% coverage, the leverage you get from the tests experiences a step-function
increase.
When a model adds or changes code, we force it to demonstrate how that line behav
It can’t stop at “this seems right.” It has to back it up with an executable example.
Other nice benefits: Unreachable code gets deleted. Edge cases are made explicit. A
code reviews become easier because you see concrete examples of how every aspect
the system is expected to behave or change.
Namespaces Are One Honking Great Idea. Let’s d
more of those. 4
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
4/13
The main mechanism agentic tools use to navigate your codebase is the filesystem.
They list directories, read filenames, search for strings, and pull files into context.
You should treat your directory structure and file naming with the same
thoughtfulness you’d treat any other interface.
A file called ./billing/invoices/compute.ts communicates much more than ./utils/helpers
even if the code inside is identical. Help the LLM out and give your files thoughtful
organization.
Additionally, prefer many small well-scoped files.
It improves how context gets loaded. Agents often summarize or truncate large file
when they pull them into their working set. Small files reduce that risk. If a file is
short enough to be loaded in full, the model can keep the entire thing active in cont
In practice, it will speed up the agent’s flow and eliminate a whole class of degraded
performance.
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
5/13
In the old world, you lived in one dev environment. This is where you’d craft your
perfect solution, tweak things, run commands, restart servers, and gradually conver
on a solution.
With agents, you do something closer to beekeeping, orchestrating across processes
without knowing the specifics of what exactly is happening within each of them. So
you need to cultivate a good and healthy hive.
You need your automated guardrails to run quickly, because you need to run them
often.
The goal is to keep the agent on a short leash: make a small change, check it, fix it, repe
Fast, Ephemeral, Concurrent Dev Environments
Fast
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
6/13
You can run them a few ways: agent hooks, git hooks, or just prompting (i.e. in your
AGENTS.md), but no matter how you run them, your quality checks need to be chea
enough that running them constantly is not slowing things down.
In our setup, every npm test creates a brand new database, runs migrations, and
executes the full suite.
This only works for us because we’ve made each of those stages exceptionally fast. W
run tests with high concurrency, strong isolation, and a caching layer for third-party
calls 5. We have 10,000+ assertions that finish in about a minute. Without caching, it
takes 20-30 minutes, which would add hours if you expected an agent to run tests
several times per task.
Once you get comfortable with agents, you naturally start running many of them.
You’ll spin up and tear down many dev environments multiple times a day. That has
all be fully automated or you’ll avoid doing it.
We have a simple workflow here:
new-feature <name>
That command creates a new git worktree, copies in local config that doesn’t live in
(like .env files), installs dependencies, and then starts your agent with a prompt to
interview you to write a PRD together. If the feature name is descriptive enough, it
may even just ask to get right to work, assuming it can figure out the rest of the
context on its own.
The important part isn’t our specific scripts. It’s the latency. If it takes minutes and
involves a bunch of tinkering and manual configuration, you won’t do it. If it is one
command and takes 1-2 seconds, you’ll do it constantly.
Ephemeral
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
7/13
In our case, one command gives you a fresh, working environment almost
immediately, with an agent ready to start.
The final piece is being able to run each environment at the same time. Having a
bunch of worktrees doesn’t help if you can only have one of them active at a time.
That means anything that could conflict (e.g. ports, database names, caches,
background jobs) needs to be configurable (ideally via environment variables) or
otherwise allocated in some conflict-free way.
If you use Docker you get some of this for free, but the general requirement is the
same: you need a solid isolation story so you can run several fully functioning dev
environments on one machine without cross-talk.
Concurrent
End-To-End Types
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
8/13
More broadly, automate the enforcement of as many best practices as you can. Rem
degrees of freedom from the LLM. If you’re not already using automatic linters and
formatters 6, start there. Make those as strict as possible and configured to
automatically apply fixes whenever the LLM finishes a task or is about to commit 7.
But you should also be using a typed language 8.
Entire categories of illegal states and transitions can be eliminated. And types shrin
the search space of possible actions the model can take, while doubling as source-o
truth documentation describing exactly what kind of data flows through each layer.
We lean on TypeScript pretty heavily. If something can be reasonably represented
cleanly in the type system, we do it.
And we push semantic meaning into the type names. The goal is to make “what is
this?” and “where does it go?” answerable at a glance.
TypeScript
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
9/13
When you’re working with agents, good semantic names are an amplifier. If the mo
sees a type like UserId, WorkspaceSlug, or SignedWebhookPayload, it can
immediately understand what kind of thing it is dealing with. It can also search for
that thing easily.
Generic names like T are fine when you’re writing a small self-contained generic
algorithm, but much less helpful when you’re communicating intent inside a real
business system.
On the API side, we use OpenAPI and generate well-typed clients, so the frontend 
backend agree on shapes.
On the data side, we use Postgres’ type system as best as we can, and add checks an
triggers for invariants that don’t fit into simple column types. Postgres doesn’t have
particularly rich type system, but it has enough there to enforce a surprising amoun
correctness. If an agent tries to write invalid data, our database will usually complai
clearly and loudly. And we use Kysely to generate well-typed TypeScript clients for 
All of our other 3rd-party clients either give us good types, or we wrap them to give
good types.
Agents are tireless and often brilliant coders, but they’re only as effective as the
environment you place them in. Once you realize this, “good code” stops feeling
superfluous and starts feeling essential.
Yes, the upfront work feels like a tax, but it’s the same tax we’ve all been dodging fo
years. So pay it intentionally. Put it on your agentic roadmap, get it funded by eng
leadership, and finally ship the codebase you always hoped for.
OpenAPI
Postgres
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
10/13
1
Often, when teams struggle with agentic coding, it’s AI reflecting and amplifying their
codebase’s worst tendencies.
2
100% coverage is actually the minimum bar we set. We encourage writing tests for as ma
scenarios as is possible, even if it means the same lines getting exercised multiple times. 
gets us closer to 100% path coverage as well, though we don’t enforce (or measure) that.
3
It’s also remarkably easy to maintain 100% once you hit it. The coverage report enumerat
exactly what lines need testing, which the LLM happily handles.
4
We personally like Biome,
5
Among other mechanisms, we use githooks for this.
6
Don’t use Python. Even with type annotations. Just use TypeScript. It makes me a little s
to say, having written Python for 20+ years, but TypeScript’s is just a much better type
system.
7
https://peps.python.org/pep-0020/#the-zen-of-python
8
When we run tests in CI/CD, after the PR is approved, we run them without caching just
ensure there wasn’t a subtle assumption violated by the cache. It also double-checks that
we’re still talking to all of our 3rd-party integrations correctly.
Subscribe to Bits of Logic
AI, automation, and decision intelligence.
Type your email...
Subscribe
Type your email...
Subscribe
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
11/13
By subscribing, you agree Substack's Terms of Use, and
acknowledge its Information Collection Notice and Privacy Policy.
53 Likes ∙5 Restacks
Discussion about this post
Previous
Next
Write a comment...
bitzuist
Mar 6
Liked by Steve Krenzel
Types have been the biggest improvement for us. I also let the agent leave comments in some
places where I made a design decision that is not fully aligned, or there is some technical deb
am aware of but do not want to touch right now (which will naturally confuse the agent), I leav
commentary there why that's the case. In the end, the biggest thing to manage is how do you
ensure the context you have in your mind transferred to the agent on run time. OpenAI had a g
blogpost about agent harness that has parallels to your article. Thanks for sharing
LIKE (1)
REPLY
Barry Gitarts Feb 16
I’m wondering if types are overrated and just lead to additional context usage that could be us
reasoning on domain problems. When you think about the bugs and problems we have to dea
it’s rarely a type issue, I’m saying this as someone who worked in dynamic languages. Seems 
good test coverage would cover type issues and that would free up model context to focus on
issues.
LIKE
REPLY
Comments
Restacks
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
12/13
© 2026 Logic, Inc. · Privacy ∙ Terms ∙ Collection notice
Substack is the home for great culture
5/13/26, 4:12 PM
AI Is Forcing Us To Write Good Code - by Steve Krenzel
https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code?open=false
13/13