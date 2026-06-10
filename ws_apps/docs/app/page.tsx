import Image from 'next/image';
import Link from 'next/link';
import { BookOpen, Boxes, GitBranch, ShieldCheck } from 'lucide-react';
import { HelloButton } from './_components/hello-button';

const features = [
  {
    href: '/docs/getting-started',
    title: 'Fork-first setup',
    description: 'Initialize a new project from the GitHub template and verify the harness.',
    icon: GitBranch,
  },
  {
    href: '/docs/harness-slots',
    title: 'Eleven slots',
    description: 'Understand the stack manager, inspector, hooks, telemetry, and other plugin picks.',
    icon: Boxes,
  },
  {
    href: '/docs/workspaces',
    title: 'Workspace model',
    description: 'Use TypeScript, Rust, Python, or Go members through the same task graph.',
    icon: BookOpen,
  },
  {
    href: '/docs/github-pages',
    title: 'Published docs',
    description: 'Build the Fumadocs site as a static export and deploy it with GitHub Pages.',
    icon: ShieldCheck,
  },
];

const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] ?? '';

export default function HomePage() {
  return (
    <main className="min-h-screen home-grid">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 py-12 md:py-16">
        <div className="max-w-3xl">
          <Image
            src={`${basePath}/banner.svg`}
            alt="harness-app-template"
            width={760}
            height={220}
            priority
            className="mb-8 h-auto w-full max-w-2xl"
          />
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-fd-primary">
            Agentic engineering harness
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-fd-foreground md:text-6xl">
            Fast-feedback-loop probe banner.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-fd-muted-foreground">
            A compact guide to the template workflow, harness slots, workspace layout,
            update path, and GitHub Pages documentation pipeline.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground"
            >
              Open docs
            </Link>
            <Link
              href="https://github.com/syntropic137/harness-app-template"
              className="inline-flex items-center rounded-md border border-fd-border bg-fd-background px-4 py-2.5 text-sm font-medium text-fd-foreground"
            >
              View repository
            </Link>
          </div>
          <HelloButton />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Link
                key={feature.href}
                href={feature.href}
                className="rounded-lg border border-fd-border bg-fd-card p-5 text-fd-card-foreground transition hover:border-fd-primary"
              >
                <Icon className="mb-4 h-5 w-5 text-fd-primary" aria-hidden="true" />
                <h2 className="text-base font-semibold">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                  {feature.description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
