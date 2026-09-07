/**
 * The dataset tools: the two scrapers, the merge, and the review helpers.
 *
 * These are the ones worth combining. A character dataset is built from two
 * sources that disagree on purpose — a booru is fan art and drifts anime, a
 * game wiki is official renders and screenshots — and the useful unit of work
 * is "get me everything for this character", not "run one scraper". That is
 * what character_pack is: audio, both image sources and the merge, as one job
 * with one log.
 */

const path = require('path');
const jobs = require('../lib/jobs');
const exec = require('../lib/exec');
const datasets = require('../lib/datasets');
const ytdlp = require('../lib/ytdlp');
const powershell = require('../lib/powershell');
const { scriptTool, describeRecord, toolResult, flags, formatBytes, waitSchemaProp } = require('./common');

const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Work out which folder a scrape just wrote to.
 *
 * The folder name comes from the scraper's own normalising — a booru tag keeps
 * its series suffix, a wiki page title does not — so rather than guess it, take
 * the most recently updated dataset in that source.
 *
 * "Most recent" alone is not enough: a scrape that failed outright would
 * otherwise be handed the dataset left by whatever ran before it, and report
 * someone else's images as its own. So the manifest has to have been written
 * after this run started, and a failed run claims nothing at all.
 */
function summariseScrape(source, outOverride, since) {
  return (context = {}) => {
    const failed = context.record ? context.record.state === 'failed' : context.code !== 0;
    if (failed) return { dataset: null };

    if (outOverride) {
      const summary = datasets.summarise(path.resolve(REPO_ROOT, outOverride));
      return summary ? { dataset: summary } : { dataset: null };
    }

    const cutoff = since ? Date.parse(since) : 0;
    const candidates = datasets
      .list()
      .filter((entry) => entry.source === source && entry.manifest && entry.manifest.updated)
      .filter((entry) => Date.parse(entry.manifest.updated) >= cutoff)
      .sort((a, b) => (a.manifest.updated < b.manifest.updated ? 1 : -1));

    return { dataset: candidates[0] || null };
  };
}

const scrapeWiki = scriptTool({
  name: 'scrape_wiki',
  title: 'Scrape a game wiki for character images',
  description:
    'Build a character image dataset from a MediaWiki game wiki (bg3.wiki, cyberpunk.fandom.com, ' +
    'eldenring.wiki.gg, or any api.php host) — official renders, promotional art and in-game ' +
    'screenshots, which is the character as the game actually draws them. Writes ' +
    'scrape-wiki/out/<character>/ with a .txt caption beside each image and a manifest recording ' +
    'each file\'s source page and licence. Icons, sprites, item charts and merchandise photos are ' +
    'filtered out. Expect tens of images, not hundreds — wikis are small. Needs "wiki" and "page" ' +
    'to run without prompting.',
  command: { node: 'scrape-wiki/index.js' },
  what: 'The wiki scrape',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  schema: {
    required: ['wiki', 'page'],
    properties: {
      wiki: {
        type: 'string',
        minLength: 1,
        description: 'Wiki host or full api.php URL, e.g. "bg3.wiki", "cyberpunk.fandom.com", "eldenring.wiki.gg".',
      },
      page: { type: 'string', minLength: 1, description: 'Exact article title, e.g. "Shadowheart", "Panam Palmer".' },
      character: {
        type: 'string',
        description: 'Folder name and caption trigger word. Defaults to the page title.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 500, description: 'How many images to keep. Default 40.' },
      min_size: { type: 'integer', minimum: 1, description: 'Reject images smaller than this on the short side. Default 512.' },
      max_size: { type: 'integer', minimum: 0, description: 'Cap the short side. 0 keeps wiki originals. Default 1024.' },
      out: { type: 'string', description: 'Write somewhere other than scrape-wiki/out/<character>/.' },
      caption: { type: 'string', description: 'Caption text after the character name. Default "official art".' },
      no_captions: { type: 'boolean', description: 'Skip writing .txt caption files.' },
      crop: { type: 'boolean', description: 'Detect faces and crop a second person out of frame. Best effort.' },
      resize_only: { type: 'boolean', description: 'Re-cap and re-crop images already on disk without downloading.' },
    },
  },
  buildArgv: (args) =>
    flags([
      ['--wiki', args.wiki],
      ['--page', args.page],
      ['--character', args.character],
      ['--limit', args.limit],
      ['--min-size', args.min_size],
      ['--max-size', args.max_size],
      ['--out', args.out],
      ['--caption', args.caption],
      ['--no-captions', args.no_captions],
      ['--crop', args.crop],
      ['--resize-only', args.resize_only],
    ]),
  summarise: (context) => summariseScrape('wiki', context.args.out, context.record.started)(context),
});

const scrapeBooru = scriptTool({
  name: 'scrape_booru',
  title: 'Scrape Gelbooru for character images',
  description:
    'Build a captioned character image dataset from Gelbooru — fan art, with booru tags as the ' +
    'caption, which is what most LoRA training expects. Writes scrape-booru/out/<tag>/ with a .txt ' +
    'caption beside each image and a manifest. Needs the exact booru tag, which carries the series: ' +
    '"shadowheart_(baldur\'s_gate)", not "shadowheart". Supplying "tag" runs it without prompting.',
  command: { node: 'scrape-booru/index.js' },
  what: 'The booru scrape',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  schema: {
    required: ['tag'],
    properties: {
      tag: { type: 'string', minLength: 1, description: 'Exact Gelbooru character tag, e.g. "tifa_lockhart", "makima_(chainsaw_man)".' },
      limit: { type: 'integer', minimum: 1, maximum: 1000, description: 'How many images to fetch. Default 40.' },
      rating: {
        type: 'string',
        enum: ['general', 'safe', 'any'],
        description: '"general" only, "safe" for general + sensitive, or "any". Default general.',
      },
      style: {
        type: 'string',
        enum: ['any', 'official', '3d', 'real'],
        description: 'Narrow towards official art or 3D renders. Default any.',
      },
      sort: { type: 'string', enum: ['score', 'newest'], description: 'Post ordering. Default score.' },
      extra: {
        type: 'string',
        description: 'Extra query tags, e.g. "solo simple_background -comic". Pass "" to clear the defaults.',
      },
      out: { type: 'string', description: 'Write somewhere other than scrape-booru/out/<tag>/.' },
      max_size: { type: 'integer', minimum: 0, description: 'Cap the short side. 0 keeps booru originals. Default 1024.' },
      no_captions: { type: 'boolean', description: 'Skip writing .txt caption files.' },
      crop: { type: 'boolean', description: 'Detect faces and crop a second person out of frame. Best effort.' },
      resize_only: { type: 'boolean', description: 'Re-cap and re-crop images already on disk without downloading.' },
    },
  },
  buildArgv: (args) =>
    flags([
      ['--tag', args.tag],
      ['--limit', args.limit],
      ['--rating', args.rating],
      ['--style', args.style],
      ['--sort', args.sort],
      // An empty --extra is meaningful (it clears the default filters), so it
      // has to survive the falsy check that drops every other absent flag.
      ['--extra', args.extra === '' ? '' : args.extra],
      ['--out', args.out],
      ['--max-size', args.max_size],
      ['--no-captions', args.no_captions],
      ['--crop', args.crop],
      ['--resize-only', args.resize_only],
    ]),
  summarise: (context) => summariseScrape('booru', context.args.out, context.record.started)(context),
});

const mergeDatasets = scriptTool({
  name: 'merge_datasets',
  title: 'Merge scraped datasets per character',
  description:
    'Gather the datasets produced by scrape_booru and scrape_wiki into merge-datasets/out/<character>/ — ' +
    'one folder per character, both sources combined, ready to point a trainer at. Matches the two ' +
    'sources\' different folder names for the same character. Sources are only ever read.',
  command: { node: 'merge-datasets/index.js' },
  what: 'The merge',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    properties: {
      out: { type: 'string', description: 'Write somewhere other than merge-datasets/out/.' },
      per_character: { type: 'integer', minimum: 0, description: 'Cap how many images each character contributes. 0 means all.' },
      only: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description: 'Merge just these characters (substring match).',
      },
      repeats: { type: 'integer', minimum: 0, description: 'Prefix folders "<n>_" for kohya repeat counts. 0 means no prefix.' },
      flat: { type: 'boolean', description: 'Put every image in one folder instead of one per character.' },
      clean: { type: 'boolean', description: 'Empty the output folder before merging.' },
    },
  },
  buildArgv: (args) =>
    flags([
      ['--out', args.out],
      ['--per-character', args.per_character],
      ['--only', args.only ? args.only.join(',') : null],
      ['--repeats', args.repeats],
      ['--flat', args.flat],
      ['--clean', args.clean],
    ]),
  summarise: ({ args }) => {
    const only = Array.isArray(args.only) ? args.only : null;
    const merged = datasets.list().filter((entry) => entry.source === 'merged');
    return {
      merged: only
        ? merged.filter((entry) => only.some((name) => datasets.baseName(entry.name).includes(datasets.baseName(name))))
        : merged,
    };
  },
});

const datasetList = {
  name: 'dataset_list',
  title: 'List character datasets on disk',
  description:
    'List the character datasets already built, across all three sources (booru, wiki, merged), with ' +
    'image and caption counts, size on disk, and where each came from. Reads the filesystem only — no ' +
    'network, instant. Use this before scraping to see what exists, and after to check what landed.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      character: {
        type: 'string',
        description:
          'Only datasets for this character. Matching is loose, so "shadowheart" finds the wiki\'s ' +
          '"shadowheart" and the booru\'s "shadowheart__baldur_s_gate".',
      },
      include_samples: {
        type: 'integer',
        minimum: 0,
        maximum: 20,
        default: 0,
        description: 'Also return this many image paths per dataset, spread across the folder.',
      },
    },
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  async run(args) {
    const found = datasets.list({ character: args.character || null });

    const enriched = found.map((entry) => ({
      ...entry,
      size: formatBytes(entry.bytes),
      samples: args.include_samples ? datasets.sampleFiles(entry.dir, args.include_samples) : undefined,
    }));

    const totalImages = found.reduce((sum, entry) => sum + entry.images, 0);
    const scope = args.character ? ` matching "${args.character}"` : '';

    if (found.length === 0) {
      return toolResult(
        `No datasets${scope} yet. scrape_wiki and scrape_booru build them; character_pack does both at once.`,
        { datasets: [] }
      );
    }

    return toolResult(
      `${found.length} dataset(s)${scope}, ${totalImages} images total.`,
      { datasets: enriched, total_images: totalImages }
    );
  },
};

const contactSheet = scriptTool({
  name: 'dataset_contact_sheet',
  title: 'Lay a dataset out as one numbered grid',
  description:
    'Render every image in a folder as one numbered contact sheet, eight to a row, so a dataset can ' +
    'be judged at a glance instead of one file at a time. The printed numbers match the cells, so a ' +
    'bad cell maps straight to the file to delete. Folders starting with "_" are skipped by ' +
    'resize_only passes, which makes out/_review/ a safe place to keep sheets.',
  command: { node: 'scrape-wiki/contact-sheet.js' },
  what: 'The contact sheet',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  schema: {
    required: ['dir', 'out_file'],
    properties: {
      dir: { type: 'string', minLength: 1, description: 'Absolute path to the dataset folder to lay out.' },
      out_file: { type: 'string', minLength: 1, description: 'Absolute path for the sheet, ending .jpg.' },
    },
  },
  buildArgv: (args) => [path.resolve(REPO_ROOT, args.dir), path.resolve(REPO_ROOT, args.out_file)],
  summarise: ({ args }) => ({ sheet: require('path').resolve(args.out_file) }),
});

const cropImage = scriptTool({
  name: 'dataset_crop',
  title: 'Hand-crop one dataset image',
  description:
    'Trim one image in place, for the frames face detection cannot fix — a companion turned away, a ' +
    'background dancer, someone half out of shot. Specs apply left to right. Re-encodes JPEG at the ' +
    'same quality as the scrapers\' size cap. Worth checking what the crop leaves: trimming a group ' +
    'shot down to one character can produce a strip whose face is too small to train on.',
  command: { node: 'scrape-wiki/crop.js' },
  what: 'The crop',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  schema: {
    required: ['image', 'specs'],
    properties: {
      image: { type: 'string', minLength: 1, description: 'Absolute path to the image. Edited in place.' },
      specs: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', minLength: 1 },
        description:
          'Crop specs applied in order: "right:40%", "left:10%", "top:5%", "bottom:12%", "center:60%", ' +
          'or "box:x,y,w,h".',
      },
    },
  },
  buildArgv: (args) => [path.resolve(REPO_ROOT, args.image), ...args.specs],
});

/* -------------------------------------------------------------------------- */
/* character_pack                                                             */
/* -------------------------------------------------------------------------- */

const characterPack = {
  name: 'character_pack',
  title: 'Build a full character pack: audio + wiki + booru + merge',
  description:
    'Everything for one character in a single job: optionally pull voice audio, scrape the game wiki ' +
    'for official art, scrape Gelbooru for fan art, then merge both image sources into one training ' +
    'folder. Steps run in order under one job id with one log. Image sources are independent — if the ' +
    'wiki has nothing, the booru scrape and merge still run. Audio needs either "audio_urls" or ' +
    '"audio_search: true"; leave both out and the audio step is skipped entirely. Wiki scraping needs ' +
    '"wiki"; without it that step is skipped too.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['character'],
    properties: {
      character: {
        type: 'string',
        minLength: 1,
        description: 'The character. Used as the trigger word, the merge folder name, and the default for the wiki page and audio search.',
      },
      wiki: {
        type: 'string',
        description: 'Wiki host for the official-art step, e.g. "bg3.wiki". Omit to skip the wiki entirely.',
      },
      page: { type: 'string', description: 'Wiki article title. Defaults to "character".' },
      booru_tag: {
        type: 'string',
        description:
          'Exact Gelbooru tag, which usually carries the series: "shadowheart_(baldur\'s_gate)". ' +
          'Defaults to the character name, which is often wrong for a tagged franchise — pass it ' +
          'explicitly when the character has a series suffix. Pass "" to skip the booru step.',
      },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 40, description: 'Images per image source.' },
      rating: { type: 'string', enum: ['general', 'safe', 'any'], description: 'Booru content rating. Default general.' },
      crop: { type: 'boolean', default: false, description: 'Face-detect and crop a second person out of frame, both image sources.' },
      audio_urls: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        description: 'URLs or local video paths to pull audio from. Turns the audio step on.',
      },
      audio_search: {
        type: 'boolean',
        default: false,
        description:
          'Instead of supplying URLs, search YouTube via yt-dlp and take the top hits. Off by default; ' +
          'the query and everything it picked are reported back so a wrong pick is visible.',
      },
      audio_query: { type: 'string', description: 'Search phrase. Defaults to "<character> voice lines".' },
      audio_count: { type: 'integer', minimum: 1, maximum: 10, default: 3, description: 'How many search hits to take.' },
      audio_duration: {
        type: 'number',
        minimum: 0,
        default: 60,
        description: 'Seconds of audio per source, from a random start. 0 takes whole tracks, which for a long compilation is a very large file.',
      },
      audio_format: { type: 'string', enum: ['wav', 'mp3', 'm4a', 'flac'], default: 'wav', description: 'Audio format.' },
      audio_out: { type: 'string', description: 'Where audio lands. Defaults to get-audio/out/.' },
      merge: { type: 'boolean', default: true, description: 'Merge both image sources into merge-datasets/out/<character>/ at the end.' },
      ...waitSchemaProp,
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },

  async run(args) {
    if (process.platform !== 'win32' && (args.audio_urls || args.audio_search)) {
      throw new Error(
        'The audio step runs get-audio, which is PowerShell and Windows-only. Drop audio_urls/audio_search, ' +
          'or use extract_audio on local video files instead.'
      );
    }

    // Every step's summariser needs to know when the pack began, so a scrape
    // that produced nothing cannot be credited with an older dataset.
    const startedAt = new Date().toISOString();
    const steps = [];
    const plan = { character: args.character, audio: null, wiki: null, booru: null, merge: Boolean(args.merge) };

    // ---- Audio ------------------------------------------------------------
    let audioUrls = args.audio_urls || null;
    let searchHits = null;

    if (!audioUrls && args.audio_search) {
      const query = args.audio_query || `${args.character} voice lines`;
      searchHits = ytdlp.search(query, args.audio_count);
      audioUrls = searchHits.map((hit) => hit.url);
      plan.audio = { query, hits: searchHits };
      if (audioUrls.length === 0) {
        throw new Error(`The search for "${query}" found nothing. Pass audio_urls instead.`);
      }
    } else if (audioUrls) {
      plan.audio = { urls: audioUrls };
    }

    if (audioUrls) {
      steps.push({
        label: `audio (${audioUrls.length} source${audioUrls.length === 1 ? '' : 's'})`,
        spec: { binary: 'powershell.exe' },
        argv: powershell.callScript(path.join(REPO_ROOT, 'get-audio', 'Get-Audio.ps1'), [
          ['-Url', audioUrls],
          ['-Format', args.audio_format],
          ['-Duration', args.audio_duration],
          ['-OutDir', args.audio_out],
        ]),
        // Audio is a nice-to-have next to the images; a dead video should not
        // cost the caller the whole dataset.
        optional: true,
      });
    }

    // ---- Wiki -------------------------------------------------------------
    if (args.wiki) {
      plan.wiki = { wiki: args.wiki, page: args.page || args.character };
      steps.push({
        label: `wiki scrape (${args.wiki})`,
        spec: { node: 'scrape-wiki/index.js' },
        argv: flags([
          ['--wiki', args.wiki],
          ['--page', args.page || args.character],
          ['--character', args.character],
          ['--limit', args.limit],
          ['--crop', args.crop],
        ]),
        optional: true,
        summarise: summariseScrape('wiki', null, startedAt),
      });
    }

    // ---- Booru ------------------------------------------------------------
    const tag = args.booru_tag === '' ? null : args.booru_tag || datasets.normalise(args.character);
    if (tag) {
      plan.booru = { tag };
      steps.push({
        label: `booru scrape (${tag})`,
        spec: { node: 'scrape-booru/index.js' },
        argv: flags([
          ['--tag', tag],
          ['--limit', args.limit],
          ['--rating', args.rating],
          ['--crop', args.crop],
        ]),
        optional: true,
        summarise: summariseScrape('booru', null, startedAt),
      });
    }

    if (steps.length === 0) {
      throw new Error(
        'Nothing to do: pass "wiki" for official art, a "booru_tag" for fan art, or audio_urls/audio_search for audio.'
      );
    }

    // ---- Merge ------------------------------------------------------------
    if (args.merge && (args.wiki || tag)) {
      steps.push({
        label: 'merge',
        spec: { node: 'merge-datasets/index.js' },
        argv: flags([['--only', datasets.baseName(args.character)]]),
        optional: true,
      });
    }

    const { record, done } = exec.startComposite('character_pack', { ...args, plan }, steps, {
      summarise: () => ({ plan, datasets: datasets.list({ character: args.character }) }),
    });

    const finished = await exec.waitFor(done, args.wait_seconds);
    const current = finished || jobs.read(record.id);

    return describeRecord(current, {
      what: `The pack for ${args.character}`,
      extra: {
        plan,
        steps_planned: steps.map((step) => step.label),
        datasets: datasets.list({ character: args.character }),
      },
    });
  },
};

module.exports = [
  characterPack,
  scrapeWiki,
  scrapeBooru,
  mergeDatasets,
  datasetList,
  contactSheet,
  cropImage,
];
