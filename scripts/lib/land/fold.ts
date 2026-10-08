/**
 * Folds terminal progress output into readable log lines.
 *
 * Tools redraw progress with a bare `\r`. Written to a file that becomes one
 * enormous line (or, split on `\r`, thousands of near-duplicates). A terminal
 * would show only the last redraw of each line, so that is what is kept.
 */
export interface LineFolder {
  write(chunk: string): void;
  end(): void;
}

export function foldedLine(raw: string): string {
  const stripped = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  const lastReturn = stripped.lastIndexOf('\r');
  return lastReturn === -1 ? stripped : stripped.slice(lastReturn + 1);
}

export function createLineFolder(emit: (line: string) => void): LineFolder {
  let pending = '';
  return {
    write(chunk) {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) {
        emit(foldedLine(pending.slice(0, newline)));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf('\n');
      }
    },
    end() {
      if (pending !== '') {
        emit(foldedLine(pending));
        pending = '';
      }
    },
  };
}
