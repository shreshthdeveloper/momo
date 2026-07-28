import js from '@eslint/js';

/**
 * The rule that matters here is `tenant/scoped-queries`.
 *
 * tech.md §4: "Every space-scoped Mongoose query includes `spaceId`. A lint
 * rule flags queries on space-scoped models without it." A leak between
 * institutes is an incident rather than a bug, so the guard is mechanical
 * rather than a habit someone has to remember.
 *
 * A query that is genuinely cross-space — resolving which spaces a user
 * belongs to, or hydrating names for ids that came out of an already-scoped
 * aggregation — must say so with a `// tenant-ok: <reason>` comment above it.
 * Writing the reason down is the point: it turns "I checked this" into
 * something the next reader can verify.
 */

const SPACE_SCOPED_MODELS = [
  'Topic',
  'Category',
  'Batch',
  'SpaceMember',
  // Phase 3. A contest's standings and an assignment's progress are the most
  // sensitive per-student data an institute holds, so they are covered from
  // the day the models exist rather than the day someone remembers.
  'Contest',
  'ContestEntry',
  'Assignment',
  'AssignmentProgress',
];
const QUERY_METHODS = [
  'find',
  'findOne',
  'countDocuments',
  'aggregate',
  'distinct',
  'updateMany',
  'deleteMany',
  'findOneAndUpdate',
];

/**
 * Anything that shows the filter derives from a resolved scope: a literal
 * `spaceId` / `origin` key, or a `scope` object threaded into it (directly or
 * through a helper like `baseTopicFilter(scope)`).
 *
 * This is a tripwire, not a proof — `tests/cross-tenant.test.js` is what
 * actually guarantees isolation. The rule's job is to make the omission
 * visible while someone is still writing the query.
 */
const SCOPED_PATTERN = /spaceId|origin|\bscope\b/;

const tenantPlugin = {
  rules: {
    'scoped-queries': {
      meta: {
        type: 'problem',
        docs: { description: 'space-scoped model queries must filter by spaceId (tech.md §4)' },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;

        /**
         * Resolve `Model.find(filter)` where `filter` is a local variable, by
         * reading the text of its declaration and any later assignments into
         * it. Without this the rule fires on every handler that builds its
         * filter in steps — and a rule that cries wolf gets switched off.
         */
        const resolveFilterText = (node, depth = 0) => {
          if (depth > 3) return sourceCode.getText(node);

          // `Model.find({ ...base, _id: ... })` — follow the spread, because
          // building a filter from a scoped base is the normal, correct shape.
          if (node.type === 'ObjectExpression') {
            const parts = [sourceCode.getText(node)];
            for (const prop of node.properties) {
              if (prop.type === 'SpreadElement') {
                parts.push(resolveFilterText(prop.argument, depth + 1));
              }
            }
            return parts.join('\n');
          }

          if (node.type !== 'Identifier') return sourceCode.getText(node);

          const scope = sourceCode.getScope(node);
          let variable = null;
          for (let s = scope; s && !variable; s = s.upper) {
            variable = s.variables.find((v) => v.name === node.name) ?? null;
          }
          if (!variable) return sourceCode.getText(node);

          const texts = [];
          for (const def of variable.defs) {
            if (def.node?.init) texts.push(sourceCode.getText(def.node.init));
          }
          // `filter.spaceId = ...` after the declaration counts too.
          for (const ref of variable.references) {
            const parent = ref.identifier.parent;
            if (parent?.type === 'MemberExpression') texts.push(sourceCode.getText(parent));
          }
          return texts.join('\n');
        };

        const hasEscapeHatch = (node) => {
          const line = node.loc.start.line;
          return sourceCode
            .getAllComments()
            .some((c) => /tenant-ok:\s*\S/.test(c.value) && c.loc.end.line >= line - 4 && c.loc.end.line <= line);
        };

        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== 'MemberExpression') return;
            const model = callee.object?.name;
            const method = callee.property?.name;
            if (!SPACE_SCOPED_MODELS.includes(model)) return;
            if (!QUERY_METHODS.includes(method)) return;

            const filter = node.arguments[0];
            if (!filter) return;

            const text = resolveFilterText(filter);
            if (SCOPED_PATTERN.test(text)) return;
            if (hasEscapeHatch(node)) return;

            context.report({
              node,
              message:
                `${model}.${method}() must filter by spaceId (tech.md §4). ` +
                'If this query is genuinely cross-space, add a "// tenant-ok: <reason>" comment above it.',
            });
          },
        };
      },
    },
  },
};

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['src/services/**/*.js', 'src/routes/**/*.js', 'src/game/**/*.js'],
    plugins: { tenant: tenantPlugin },
    rules: { 'tenant/scoped-queries': 'error' },
  },
  { ignores: ['node_modules/**', 'uploads/**', 'coverage/**'] },
];
