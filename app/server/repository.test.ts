import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'bun:test';
import { NodeServices } from '@effect/platform-node';
import * as Effect from 'effect/Effect';
import type { Stage } from '../contract.ts';
import { makeRepository } from './repository.ts';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const makeDirectory = async (files: Partial<Record<Stage, string>> = {}) => {
  const directory = await mkdtemp(join(tmpdir(), 'session-app-'));
  directories.push(directory);
  for (const stage of ['TRIAGE', 'DESIGN', 'BATCH', 'EXECUTE'] as const) {
    await writeFile(join(directory, `${stage}.md`), files[stage] ?? '');
  }
  return directory;
};

const make = (directory: string) =>
  Effect.runPromise(makeRepository(directory).pipe(Effect.provide(NodeServices.layer)));

const allSections = `### Decision
Keep the item.

### Open questions
Resolve the remaining choice.

### Outcome
The behavior works.

### Acceptance
The observable result passes.`;

const batchItem = (id: string, title = id) => `## ${id} — ${title}

### Outcome
${title} works.

### Acceptance
The observable result passes.
`;

describe('session repository', () => {
  test('initializes only missing stage files and reads require a complete session', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'session-app-'));
    directories.push(directory);
    const existing = '## D-1 — Existing\n\n### Open questions\nKeep this content?\n';
    await writeFile(join(directory, 'DESIGN.md'), existing);
    const repository = await make(directory);

    await expect(Effect.runPromise(repository.load)).rejects.toThrow(
      'Session is missing TRIAGE.md.',
    );
    await Effect.runPromise(repository.initialize);

    expect(await readFile(join(directory, 'DESIGN.md'), 'utf8')).toBe(existing);
    expect(await readFile(join(directory, 'EXECUTE.md'), 'utf8')).toBe('');

    await mkdir(join(directory, 'context'));
    await mkdir(join(directory, 'ignore'));
    await writeFile(join(directory, 'context/research.md'), 'live context');
    await writeFile(join(directory, 'ignore/archive.md'), 'excluded archive');
    await symlink('../ignore/archive.md', join(directory, 'context/archive-link.md'));
    expect(Object.keys(await Effect.runPromise(repository.inventory))).toEqual([
      'BATCH.md',
      'DESIGN.md',
      'EXECUTE.md',
      'TRIAGE.md',
      'context/research.md',
    ]);
  });

  test('parses free Markdown without turning fenced item examples into cards', async () => {
    const markdown = `## DES-1 — Keep fences

### Open questions
Should this remain one card? Yes.

\`\`\`md
## EXAMPLE-2 — This is code, not a card
\`\`\`
`;
    const directory = await makeDirectory({ DESIGN: markdown });
    const repository = await make(directory);
    const session = await Effect.runPromise(repository.load);

    expect(session.stages.find((stage) => stage.stage === 'DESIGN')?.items).toEqual([
      {
        id: 'DES-1',
        title: 'Keep fences',
        body: `### Open questions
Should this remain one card? Yes.

\`\`\`md
## EXAMPLE-2 — This is code, not a card
\`\`\``,
        summary: 'Should this remain one card? Yes.',
        group: null,
      },
    ]);
  });

  test('rejects duplicate IDs across stages and incomplete stage contracts', async () => {
    const duplicate = await makeDirectory({
      TRIAGE: `## SAME — Triage

### Decision
Decide it.
`,
      DESIGN: `## SAME — Design

### Open questions
Ask it.
`,
    });
    const duplicateRepository = await make(duplicate);
    await expect(Effect.runPromise(duplicateRepository.load)).rejects.toThrow(
      'Item ID SAME appears in both TRIAGE and DESIGN.',
    );

    const incomplete = await makeDirectory({ BATCH: '## B-1 — Missing acceptance\n\n### Outcome\nDone.\n' });
    const incompleteRepository = await make(incomplete);
    await expect(Effect.runPromise(incompleteRepository.load)).rejects.toThrow(
      'BATCH/B-1: ### Acceptance requires content.',
    );
  });

  test('edits one card without changing its neighbor and generates compact IDs', async () => {
    const neighbor = `## DES-2 — Neighbor

### Open questions
Keep this exactly? Yes.
`;
    const directory = await makeDirectory({
      DESIGN: `## DES-1 — Before

### Open questions
What should change? The first card.

${neighbor}`,
    });
    const repository = await make(directory);
    const before = await Effect.runPromise(repository.load);
    const edited = await Effect.runPromise(
      repository.updateItem({
        id: 'DES-1',
        title: 'After',
        body: '### Open questions\nWhat changed? Only this card.',
        revision: before.revision,
      }),
    );

    expect(await readFile(join(directory, 'DESIGN.md'), 'utf8')).toEndWith(neighbor);
    expect(edited.stages.find((stage) => stage.stage === 'DESIGN')?.items[0]).toMatchObject({
      id: 'DES-1',
      title: 'After',
      body: '### Open questions\nWhat changed? Only this card.',
    });

    const added = await Effect.runPromise(
      repository.addItem({
        stage: 'TRIAGE',
        title: 'Generated ID',
        body: '### Decision\nDecide this later.',
        revision: edited.revision,
      }),
    );
    expect(added.stages.find((stage) => stage.stage === 'TRIAGE')?.items[0]?.id).toMatch(
      /^W-[0-9a-f]{8}$/,
    );
  });

  test('moves a full record, zeroes the emptied file, and refuses a stale disk edit', async () => {
    const triage = `## MOVE-1 — Preserve me

### Decision
Move it after adding the design question.
`;
    const directory = await makeDirectory({ TRIAGE: triage });
    const repository = await make(directory);
    const before = await Effect.runPromise(repository.load);

    await expect(
      Effect.runPromise(
        repository.moveItem({ id: 'MOVE-1', to: 'DESIGN', revision: before.revision }),
      ),
    ).rejects.toThrow('DESIGN/MOVE-1: ### Open questions requires content.');
    expect(await readFile(join(directory, 'TRIAGE.md'), 'utf8')).toBe(triage);
    expect(await readFile(join(directory, 'DESIGN.md'), 'utf8')).toBe('');

    const amendedBody = `### Decision
Move it after adding the design question.

### Open questions
Which implementation should we use?`;
    const moved = await Effect.runPromise(
      repository.moveItem({
        id: 'MOVE-1',
        to: 'DESIGN',
        body: amendedBody,
        revision: before.revision,
      }),
    );

    expect(await readFile(join(directory, 'TRIAGE.md'), 'utf8')).toBe('');
    expect(moved.stages.find((stage) => stage.stage === 'DESIGN')?.items[0]).toMatchObject({
      id: 'MOVE-1',
      title: 'Preserve me',
      body: amendedBody,
    });

    await writeFile(
      join(directory, 'TRIAGE.md'),
      '## EXTERNAL — Disk edit\n\n### Decision\nKeep it.\n',
    );
    await expect(
      Effect.runPromise(
        repository.moveItem({ id: 'MOVE-1', to: 'TRIAGE', revision: moved.revision }),
      ),
    ).rejects.toThrow('Session changed on disk. Reload before saving.');
  });

  test('freezes execution, completes into the archive, and starts the next batch only when empty', async () => {
    const directory = await makeDirectory({
      TRIAGE: `## READY-1 — Newly ready

${allSections}
`,
      BATCH: `# Ready

${batchItem('B-1', 'First')}
${batchItem('B-2', 'Second')}`,
    });
    const repository = await make(directory);
    const initial = await Effect.runPromise(repository.load);
    const ready = await Effect.runPromise(
      repository.moveItem({ id: 'READY-1', to: 'BATCH', revision: initial.revision }),
    );
    expect(ready.stages.find((stage) => stage.stage === 'BATCH')?.items.map((item) => item.id)).toEqual([
      'READY-1',
      'B-1',
      'B-2',
    ]);
    const executing = await Effect.runPromise(
      repository.startBatch({ ids: ['B-1'], name: 'Today', revision: ready.revision }),
    );

    expect(executing.stages.find((stage) => stage.stage === 'EXECUTE')?.items).toMatchObject([
      { id: 'B-1', group: 'Today' },
    ]);
    await expect(
      Effect.runPromise(
        repository.startBatch({ ids: ['B-2'], name: 'Later', revision: executing.revision }),
      ),
    ).rejects.toThrow('Complete the current EXECUTE batch first.');
    await expect(
      Effect.runPromise(
        repository.putFile({ stage: 'EXECUTE', markdown: '', revision: executing.revision }),
      ),
    ).rejects.toThrow('EXECUTE edits must preserve its item IDs and groups.');

    const clarifiedMarkdown = executing.stages
      .find((stage) => stage.stage === 'EXECUTE')!
      .markdown.replace('First works.', 'First works with clarification.');
    const clarified = await Effect.runPromise(
      repository.putFile({
        stage: 'EXECUTE',
        markdown: clarifiedMarkdown,
        revision: executing.revision,
      }),
    );

    const completed = await Effect.runPromise(
      repository.completeItem({ id: 'B-1', revision: clarified.revision }),
    );
    expect(await readFile(join(directory, 'EXECUTE.md'), 'utf8')).toBe('');
    expect(await readFile(join(directory, 'ignore/COMPLETED.md'), 'utf8')).toBe(
      `# Today

${batchItem('B-1', 'First').replace('First works.', 'First works with clarification.')}`,
    );

    const next = await Effect.runPromise(
      repository.startBatch({ ids: ['B-2'], name: 'Later', revision: completed.revision }),
    );
    expect(next.stages.find((stage) => stage.stage === 'EXECUTE')?.items[0]).toMatchObject({
      id: 'B-2',
      group: 'Later',
    });
  });

  test('rolls a partially written journal forward and stops on an external conflict', async () => {
    const triageBefore = `## REC-1 — Recover me

${allSections}
`;
    const designAfter = `## REC-1 — Recover me

${allSections}
`;
    const directory = await makeDirectory({ TRIAGE: triageBefore });
    await mkdir(join(directory, '.runtime'));
    const journal = {
      version: 1,
      writes: [
        { path: 'TRIAGE.md', before: triageBefore, after: '' },
        { path: 'DESIGN.md', before: '', after: designAfter },
      ],
    };
    await writeFile(join(directory, 'TRIAGE.md'), '');
    await writeFile(join(directory, '.runtime/transaction.json'), JSON.stringify(journal));
    await writeFile(join(directory, '.runtime/access.lock'), 'another-process');

    const repository = await make(directory);
    await expect(Effect.runPromise(repository.load)).rejects.toThrow(
      'Another session process owns this directory.',
    );
    await rm(join(directory, '.runtime/access.lock'));
    const recovered = await Effect.runPromise(repository.load);
    expect(recovered.stages.find((stage) => stage.stage === 'DESIGN')?.items[0]?.id).toBe('REC-1');
    await expect(readFile(join(directory, '.runtime/transaction.json'))).rejects.toThrow();

    await writeFile(join(directory, 'TRIAGE.md'), triageBefore);
    await writeFile(join(directory, 'DESIGN.md'), 'external edit');
    await writeFile(join(directory, '.runtime/transaction.json'), JSON.stringify(journal));
    await expect(Effect.runPromise(repository.load)).rejects.toThrow(
      'Recovery stopped because DESIGN.md changed outside the session app.',
    );
  });

  test('serializes competing repositories without leaving a partial transaction', async () => {
    const directory = await makeDirectory({
      TRIAGE: `## RACE-1 — Move once

${allSections}
`,
    });
    const first = await make(directory);
    const second = await make(directory);
    const revision = (await Effect.runPromise(first.load)).revision;

    const results = await Promise.allSettled([
      Effect.runPromise(first.moveItem({ id: 'RACE-1', to: 'DESIGN', revision })),
      Effect.runPromise(second.moveItem({ id: 'RACE-1', to: 'BATCH', revision })),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const session = await Effect.runPromise(first.load);
    const destinations = session.stages
      .filter((stage) => stage.items.some((item) => item.id === 'RACE-1'))
      .map((stage) => stage.stage);
    expect(destinations).toHaveLength(1);
    expect(['DESIGN', 'BATCH']).toContain(destinations[0]);
    await expect(readFile(join(directory, '.runtime/transaction.json'))).rejects.toThrow();
    await expect(readFile(join(directory, '.runtime/access.lock'))).rejects.toThrow();
  });
});
