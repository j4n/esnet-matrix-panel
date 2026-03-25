#!/usr/bin/env bun
/**
 * Build script for esnet-matrix-panel Grafana plugin.
 * Produces AMD module output required by Grafana's plugin loader.
 *
 * Usage:
 *   bun run build.mjs [--watch] [--production]
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const production = args.includes('--production');
const watch = args.includes('--watch');

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Externals: provided by Grafana at runtime via SystemJS
const externals = [
  'react', 'react-dom',
  '@grafana/data', '@grafana/ui', '@grafana/runtime',
  '@emotion/css', '@emotion/react',
  'lodash', 'rxjs',
];

async function build() {
  const result = await Bun.build({
    entrypoints: ['./src/module.ts'],
    outdir: './dist',
    format: 'esm',
    target: 'browser',
    sourcemap: 'linked',
    minify: production,
    external: externals,
    naming: '[name].[ext]',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  if (!result.success) {
    console.error('Build failed:');
    for (const msg of result.logs) {
      console.error(msg);
    }
    process.exit(1);
  }

  // Wrap ESM output in AMD define() wrapper
  const esmCode = readFileSync('./dist/module.js', 'utf8');
  const mapFile = './dist/module.js.map';

  // No sub-path remapping needed — we use classic JSX transform (React.createElement)
  // which only requires the 'react' module, not 'react/jsx-runtime'.
  const amdExternalMap = {};

  // Single-pass: find all external imports, build dep map, and replace in one go.
  // Uses \s* (not \s+) after 'from' to handle minified output like: from"@grafana/data"
  const isExternal = (dep) => externals.some(ext => dep === ext || dep.startsWith(ext + '/'));

  // Phase 1: Discover which externals are used (single-pass scan)
  const usedExternals = [];
  const scanRegex = /from\s*["']([^"']+)["']/g;
  let match;
  while ((match = scanRegex.exec(esmCode)) !== null) {
    const dep = match[1];
    if (isExternal(dep) && !usedExternals.includes(dep)) {
      usedExternals.push(dep);
    }
  }

  // Build AMD dep list, deduplicating sub-paths (e.g. react/jsx-runtime → react)
  const amdDeps = [];
  const depVarMap = {};
  for (const dep of usedExternals) {
    const amdName = amdExternalMap[dep] || dep;
    let argIdx = amdDeps.indexOf(amdName);
    if (argIdx === -1) {
      argIdx = amdDeps.length;
      amdDeps.push(amdName);
    }
    depVarMap[dep] = `__ext_${argIdx}`;
  }

  // Phase 2: Single-pass replacement of ALL import statements
  // Handles: import{...}from"dep", import X from"dep", import * as X from"dep",
  //          import X,{...}from"dep" (combined default + named)
  const fixAliases = (names) => names.replace(/([\w$]+)\s+as\s+([\w$]+)/g, '$1: $2');
  let amdBody = esmCode.replace(
    /import\s*([\w$]+\s*,\s*\{[^}]+\}|\{[^}]+\}|\*\s*as\s+[\w$]+|[\w$]+)\s*from\s*["']([^"']+)["'];?/g,
    (full, clause, dep) => {
      const varName = depVarMap[dep];
      if (!varName) return full; // not external, leave as-is

      clause = clause.trim();
      // Combined: import X, { a, b } from "dep"
      const comboMatch = clause.match(/^([\w$]+)\s*,\s*\{([^}]+)\}$/);
      if (comboMatch) {
        const defName = comboMatch[1];
        const names = fixAliases(comboMatch[2]);
        return `var ${defName} = ${varName}.default || ${varName}; var {${names}} = ${varName};`;
      }
      if (clause.startsWith('{')) {
        // Named: import { a, b as c } from "dep"
        const names = fixAliases(clause.slice(1, -1));
        return `var {${names}} = ${varName};`;
      } else if (clause.startsWith('*')) {
        // Star: import * as X from "dep"
        const name = clause.replace(/\*\s*as\s+/, '');
        return `var ${name} = ${varName};`;
      } else {
        // Default: import X from "dep"
        return `var ${clause} = ${varName}.default || ${varName};`;
      }
    }
  );

  // Replace: export { X } -> (captured for later)
  // Collect named exports
  // Note: \w does not match $ in JS regex, so use [\w$] for JS identifiers
  const exportedNames = [];
  amdBody = amdBody.replace(
    /export\s*\{\s*([^}]+)\s*\};?/g,
    (_, names) => {
      names.split(',').forEach(n => {
        // Handle "localName as exportedName"
        const trimmed = n.trim();
        const asMatch = trimmed.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        if (asMatch) {
          exportedNames.push({ local: asMatch[1], exported: asMatch[2] });
        } else if (trimmed) {
          exportedNames.push({ local: trimmed, exported: trimmed });
        }
      });
      return '';
    }
  );
  // Replace: export var/const/let/function/class X
  amdBody = amdBody.replace(
    /export\s+(var|const|let|function|class)\s+([\w$]+)/g,
    (_, keyword, name) => {
      exportedNames.push({ local: name, exported: name });
      return `${keyword} ${name}`;
    }
  );

  const depList = amdDeps.map(d => `"${d}"`).join(', ');
  const argList = amdDeps.map((_, i) => `__ext_${i}`).join(', ');
  const returnObj = exportedNames.length > 0
    ? `return { ${exportedNames.map(e => e.local === e.exported ? e.local : `${e.exported}: ${e.local}`).join(', ')} };`
    : '';

  const amdOutput = `define([${depList}], function(${argList}) {\n${amdBody}\n${returnObj}\n});\n`;

  writeFileSync('./dist/module.js', amdOutput);

  // Copy assets
  mkdirSync('./dist/img', { recursive: true });

  // plugin.json with variable replacement
  let pluginJson = readFileSync('./src/plugin.json', 'utf8');
  pluginJson = pluginJson
    .replace(/%VERSION%/g, pkg.version)
    .replace(/%TODAY%/g, new Date().toISOString().substring(0, 10))
    .replace(/%PLUGIN_ID%/g, 'esnet-matrix-panel');
  writeFileSync('./dist/plugin.json', pluginJson);

  // Static assets
  const assets = [
    ['LICENSE', 'dist/LICENSE'],
    ['CHANGELOG.md', 'dist/CHANGELOG.md'],
    ['README.md', 'dist/README.md'],
  ];
  for (const [src, dest] of assets) {
    if (existsSync(src)) {
      cpSync(src, dest);
    }
  }
  if (existsSync('src/img')) {
    cpSync('src/img', 'dist/img', { recursive: true });
  }

  console.log(`Built dist/module.js (${(readFileSync('./dist/module.js').length / 1024).toFixed(1)} KB)`);
}

await build();

if (watch) {
  console.log('Watching for changes...');
  const { watch: fsWatch } = await import('fs');
  fsWatch('./src', { recursive: true }, async (event, filename) => {
    if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
      console.log(`\n${filename} changed, rebuilding...`);
      try {
        await build();
      } catch (e) {
        console.error('Build error:', e.message);
      }
    }
  });
  // Keep process alive
  await new Promise(() => {});
}
