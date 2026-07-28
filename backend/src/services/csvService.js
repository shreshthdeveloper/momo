import { Topic, Question } from '../models/index.js';
import { validateQuestionInput, findDuplicates, recountTopics } from './questionService.js';
import { contentHashOf } from '../lib/crypto.js';
import { QUESTION_STATUS, DIFFICULTY, DEFAULT_LANGUAGE } from '../shared/constants.js';
import { BadRequestError } from '../lib/errors.js';

/**
 * Bulk CSV import (prd.md F8.2.5) and report export (F8.6.6).
 *
 * design.md §9.4 — nothing imports until every row is valid or explicitly
 * skipped, and the error report names the failing row and reason. So this
 * validates the whole file and returns a row-by-row result; committing is a
 * separate call the admin makes after reviewing.
 */

export const IMPORT_TEMPLATE_HEADERS = [
  'question',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'correct',
  'difficulty',
  'topic',
  'tags',
  'explanation',
];

export function importTemplateCsv() {
  const sample = [
    'Which element has the atomic number 26?',
    'Iron',
    'Copper',
    'Zinc',
    'Nickel',
    'A',
    'medium',
    'Periodic Table',
    'chemistry,elements',
    'Iron (Fe) sits at atomic number 26.',
  ];
  return `${IMPORT_TEMPLATE_HEADERS.join(',')}\n${sample.map(csvCell).join(',')}\n`;
}

/** RFC 4180 parser — handles quoted fields, embedded commas, and CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text ?? '').replace(/^\uFEFF/, ''); // strip BOM from Excel

  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const head = headers.map((h) => csvCell(h.label ?? h)).join(',');
  const body = rows
    .map((row) => headers.map((h) => csvCell(typeof h === 'string' ? row[h] : h.get(row))).join(','))
    .join('\n');
  return `${head}\n${body}\n`;
}

const CORRECT_MAP = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3, 0: 0 };

/**
 * Validate a whole file without writing anything. Every row comes back with
 * its own errors so the admin can fix them inline (design.md §9.4).
 */
export async function validateImport(scope, csvText, { defaultTopicId, language = DEFAULT_LANGUAGE } = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new BadRequestError('The file has no data rows.', 'EMPTY_CSV');
  }

  const header = rows[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  const missing = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'].filter(
    (h) => !header.includes(h),
  );
  if (missing.length) {
    throw new BadRequestError(
      `The file is missing these columns: ${missing.join(', ')}. Download the template to see the expected format.`,
      'BAD_CSV_HEADER',
      { missing, found: header },
    );
  }

  const col = (name) => header.indexOf(name);
  const topics = await Topic.find({ spaceId: scope.spaceId }, { name: 1, slug: 1 }).lean();
  const topicByName = new Map(topics.map((t) => [t.name.toLowerCase(), t]));
  const topicBySlug = new Map(topics.map((t) => [t.slug, t]));

  const seenHashes = new Map();
  const results = [];

  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const get = (name) => String(cells[col(name)] ?? '').trim();

    const text = get('question');
    const options = [get('option_a'), get('option_b'), get('option_c'), get('option_d')];
    const correctRaw = get('correct').toLowerCase();
    const correctIndex = CORRECT_MAP[correctRaw] ?? Number.parseInt(correctRaw, 10);
    const difficultyRaw = (get('difficulty') || DIFFICULTY.MEDIUM).toLowerCase();
    const topicRaw = get('topic');
    const tags = get('tags')
      .split(/[;,|]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const explanation = get('explanation');

    const errors = [];

    let topic = null;
    if (topicRaw) {
      topic = topicByName.get(topicRaw.toLowerCase()) ?? topicBySlug.get(topicRaw.toLowerCase());
      if (!topic) {
        errors.push({ field: 'topic', problem: `No topic named "${topicRaw}" in this space.` });
      }
    } else if (defaultTopicId) {
      topic = topics.find((t) => String(t._id) === String(defaultTopicId)) ?? null;
      if (!topic) errors.push({ field: 'topic', problem: 'Choose a topic for rows without one.' });
    } else {
      errors.push({ field: 'topic', problem: 'This row has no topic.' });
    }

    const difficulty = Object.values(DIFFICULTY).includes(difficultyRaw)
      ? difficultyRaw
      : DIFFICULTY.MEDIUM;
    if (!Object.values(DIFFICULTY).includes(difficultyRaw) && get('difficulty')) {
      errors.push({ field: 'difficulty', problem: `"${difficultyRaw}" is not easy, medium or hard.` });
    }

    const validation = validateQuestionInput(
      { text, options, correctIndex, difficulty, topicIds: topic ? [String(topic._id)] : [] },
      { language },
    );
    errors.push(...validation.problems.filter((p) => p.field !== 'topicIds'));

    // Duplicates within the file itself, as well as against the existing bank.
    const hash = contentHashOf(text, options);
    let duplicateOf = null;
    if (seenHashes.has(hash)) {
      duplicateOf = { inFile: seenHashes.get(hash) };
      errors.push({ field: 'question', problem: `Duplicate of row ${seenHashes.get(hash)}.` });
    } else {
      seenHashes.set(hash, i + 1);
      if (topic) {
        const existing = await findDuplicates({
          scope,
          text,
          options,
          topicIds: [String(topic._id)],
        });
        if (existing.length) duplicateOf = { existing };
      }
    }

    results.push({
      row: i + 1,
      valid: errors.length === 0,
      errors,
      warnings: validation.warnings,
      duplicateOf,
      data: {
        text,
        options,
        correctIndex,
        difficulty,
        explanation: explanation || undefined,
        tags,
        topicId: topic ? String(topic._id) : null,
        topicName: topic?.name ?? topicRaw,
      },
    });
  }

  return {
    totalRows: results.length,
    validRows: results.filter((r) => r.valid).length,
    invalidRows: results.filter((r) => !r.valid).length,
    duplicateRows: results.filter((r) => r.duplicateOf).length,
    rows: results,
  };
}

/**
 * Commit rows the admin accepted. Rows are re-validated here rather than
 * trusted from the preview — the preview is a UI convenience, not a authority.
 */
export async function commitImport(scope, actor, rows, { language = DEFAULT_LANGUAGE, status = QUESTION_STATUS.DRAFT } = {}) {
  const accepted = [];
  const rejected = [];

  for (const row of rows) {
    const data = row.data ?? row;
    const validation = validateQuestionInput(
      { ...data, topicIds: data.topicId ? [data.topicId] : [] },
      { language },
    );
    if (!validation.valid || !data.topicId) {
      rejected.push({ row: row.row, errors: validation.problems });
      continue;
    }
    const topic = await Topic.findOne({ _id: data.topicId, spaceId: scope.spaceId }, { _id: 1 }).lean();
    if (!topic) {
      rejected.push({ row: row.row, errors: [{ field: 'topic', problem: 'Topic not in this space.' }] });
      continue;
    }
    accepted.push({
      origin: scope.spaceId,
      topicIds: [topic._id],
      content: {
        [language]: {
          text: data.text.trim(),
          options: data.options.map((o) => String(o).trim()),
          explanation: data.explanation?.trim() || undefined,
        },
      },
      defaultLanguage: language,
      correctIndex: data.correctIndex,
      difficulty: data.difficulty,
      tags: data.tags ?? [],
      status,
      contentHash: contentHashOf(data.text, data.options),
      source: 'import',
      createdBy: actor._id,
      searchText: [data.text, ...data.options].join(' • '),
    });
  }

  const created = accepted.length ? await Question.insertMany(accepted, { ordered: false }) : [];
  await recountTopics(accepted.flatMap((q) => q.topicIds));

  return { imported: created.length, rejected, ids: created.map((q) => String(q._id)) };
}

/** design.md §9.4 — the error report is downloadable. */
export function errorReportCsv(validation) {
  const rows = validation.rows
    .filter((r) => !r.valid)
    .flatMap((r) =>
      r.errors.map((e) => ({
        row: r.row,
        question: r.data.text?.slice(0, 80) ?? '',
        field: e.field,
        problem: e.problem,
      })),
    );
  return toCsv(['row', 'question', 'field', 'problem'], rows);
}
