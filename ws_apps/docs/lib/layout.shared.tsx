import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-semibold">Harness App Template</span>
          <span className="text-[10px] uppercase tracking-wide text-fd-muted-foreground">
            Agentic engineering
          </span>
        </div>
      ),
    },
    githubUrl: 'https://github.com/syntropic137/harness-app-template',
  };
}
