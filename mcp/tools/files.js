/**
 * Documents, archives, duplicate hunting, and the git/shell helpers.
 *
 * The git ones are the only tools here that care where they are run: they act
 * on the repository in their working directory, so they take a "repo" argument
 * and every other tool ignores cwd entirely.
 */

const path = require('path');
const { scriptTool, flags } = require('./common');

const REPO_ROOT = path.join(__dirname, '..', '..');

const ocrPdf = scriptTool({
  name: 'ocr_pdf',
  title: 'OCR scanned PDFs',
  description:
    'Add a searchable text layer to scanned PDFs. Needs ocrmypdf, Tesseract and Ghostscript installed ' +
    'on the system — this one is not self-contained like the rest. ocr-pdf is a standalone package and ' +
    'needs its own `npm install` inside ocr-pdf/ before first use. Run ocr_pdf_markdown afterwards to ' +
    'pull the text out as Markdown.',
  command: { npm: 'ocr-pdf:ocr' },
  stageDir: 'ocr-pdf',
  inputWhat: 'PDFs',
  what: 'The OCR pass',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const ocrPdfMarkdown = scriptTool({
  name: 'ocr_pdf_markdown',
  title: 'Extract Markdown from OCRd PDFs',
  description:
    'Extract the text of every PDF in ocr-pdf/out/ to Markdown beside it. This reads the OCR step\'s ' +
    'output folder rather than taking files of its own, so the normal order is ocr_pdf then this. ' +
    'Point it at PDFs that already have a text layer by copying them into ocr-pdf/out/ first.',
  command: { npm: 'ocr-pdf:md' },
  what: 'The Markdown extraction',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const mermaidToImg = scriptTool({
  name: 'mermaid_to_img',
  title: 'Render Mermaid diagrams from Markdown',
  description:
    'Find every ```mermaid fence in the given Markdown files and render each one to a PNG. A file with ' +
    'several diagrams produces several numbered images.',
  command: { npm: 'mermaid-to-img:render' },
  stageDir: 'mermaid-to-img',
  inputWhat: 'Markdown files',
  what: 'The diagram render',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const unrarFiles = scriptTool({
  name: 'unrar_files',
  title: 'Extract .rar archives',
  description: 'Extract .rar archives with node-unrar-js. No system unrar needed.',
  command: { npm: 'unrar-files:extract' },
  stageDir: 'unrar-files',
  inputWhat: '.rar archives',
  what: 'The extraction',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: { properties: {} },
  buildArgv: () => [],
});

const dedupeFiles = scriptTool({
  name: 'dedupe_files',
  title: 'Find duplicate files by hash',
  description:
    'Walk a directory tree and find byte-identical duplicates by SHA-256, writing a report. Never ' +
    'deletes anything: with "move" it relocates the extra copies into a duplicates folder so they can ' +
    'be checked before being thrown away. Hashing a large tree takes a while.',
  command: { node: 'dedupe-files/index.js' },
  what: 'The duplicate scan',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    required: ['directory'],
    properties: {
      directory: { type: 'string', minLength: 1, description: 'Absolute path to the folder to scan, recursively.' },
      move: {
        type: 'boolean',
        default: false,
        description: 'Relocate duplicate copies into dedupe-files/out/duplicates/ instead of only reporting them.',
      },
    },
  },
  buildArgv: (args) => [path.resolve(REPO_ROOT, args.directory), ...(args.move ? ['--move'] : [])],
  summarise: () => ({ report: path.join(REPO_ROOT, 'dedupe-files', 'out', 'dedupe-report.txt') }),
});

/* -------------------------------------------------------------------------- */
/* git and shell helpers                                                      */
/* -------------------------------------------------------------------------- */

const gitHistoryCsv = scriptTool({
  name: 'git_history_csv',
  title: 'Export commit history to CSV',
  description:
    'Export a repository\'s full commit history to project_history.csv in that repository — date, ' +
    'title and body per commit, with quoting that survives commit messages containing commas and ' +
    'newlines. Writes the file into the target repo, not this one.',
  command: { bash: 'bash/generate-csv.sh' },
  what: 'The history export',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    required: ['repo'],
    properties: {
      repo: { type: 'string', minLength: 1, description: 'Absolute path to the git repository to export.' },
    },
  },
  cwd: (args) => path.resolve(REPO_ROOT, args.repo),
  buildArgv: () => [],
  summarise: ({ args }) => ({ csv: path.join(path.resolve(REPO_ROOT, args.repo), 'project_history.csv') }),
});

const gitSplitCommits = scriptTool({
  name: 'git_split_commits',
  title: 'Split a branch into one branch per commit',
  description:
    'Split every commit on the current branch into its own feature/* branch, for review or for ' +
    'submitting one change at a time to Gerrit. Creates branches in the target repository; it does not ' +
    'push. Run it on a clean working tree.',
  command: { bash: 'git-split-commits/git-split-commits.sh' },
  what: 'The branch split',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  schema: {
    required: ['repo', 'target_branch'],
    properties: {
      repo: { type: 'string', minLength: 1, description: 'Absolute path to the git repository.' },
      target_branch: {
        type: 'string',
        minLength: 1,
        description: 'The branch the commits are measured against, e.g. "main".',
      },
    },
  },
  cwd: (args) => path.resolve(REPO_ROOT, args.repo),
  buildArgv: (args) => [args.target_branch],
});

const removeArtifacts = scriptTool({
  name: 'remove_artifacts',
  title: 'Delete build artifacts under a directory',
  description:
    'DESTRUCTIVE. Recursively deletes build artifacts, dependency folders and lockfiles under the given ' +
    'directory — node_modules, dist, build output and more — to leave a source-only snapshot. There is ' +
    'no undo and nothing is moved to a recycle bin. Requires confirm to be the exact string "DELETE", ' +
    'and an explicit directory: it never defaults to the current one.',
  command: { bash: 'bash/remove-artifacts.sh' },
  what: 'The artifact cleanup',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  schema: {
    required: ['directory', 'confirm'],
    properties: {
      directory: {
        type: 'string',
        minLength: 1,
        description: 'Absolute path to the directory to clean. Everything below it is in scope.',
      },
      confirm: {
        type: 'string',
        enum: ['DELETE'],
        description: 'Must be exactly "DELETE". A guard against this running on a directory nobody meant to name.',
      },
    },
  },
  cwd: (args) => path.resolve(REPO_ROOT, args.directory),
  // The script prompts interactively without --force, and there is no stdin to
  // answer it with; the confirm argument is what stands in for that prompt.
  buildArgv: () => ['--force'],
});

module.exports = [
  ocrPdf,
  ocrPdfMarkdown,
  mermaidToImg,
  unrarFiles,
  dedupeFiles,
  gitHistoryCsv,
  gitSplitCommits,
  removeArtifacts,
];
