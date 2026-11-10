/**
 * Generates clean, honest, self-contained README.md documentation for exported projects.
 * Never reads API keys, providers, or storage values.
 */

export interface ReadmeFileInput {
  path: string;
  content: string;
}

interface TreeBranch {
  name: string;
  children: Map<string, TreeBranch>;
  isFile: boolean;
}

function buildAsciiTree(paths: string[]): string {
  const root: TreeBranch = {
    name: '.',
    children: new Map(),
    isFile: false,
  };

  for (const path of paths) {
    const parts = path.split('/');
    let curr = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let next = curr.children.get(part);
      if (!next) {
        next = {
          name: part,
          children: new Map(),
          isFile: i === parts.length - 1,
        };
        curr.children.set(part, next);
      } else if (i === parts.length - 1) {
        next.isFile = true;
      }
      curr = next;
    }
  }

  const lines: string[] = ['.'];

  function renderChildren(branch: TreeBranch, prefix: string): void {
    const sorted = Array.from(branch.children.values()).sort((a, b) => {
      if (!a.isFile && b.isFile) return -1;
      if (a.isFile && !b.isFile) return 1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach((child, index) => {
      const isLast = index === sorted.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const label = child.isFile ? child.name : `${child.name}/`;
      lines.push(`${prefix}${connector}${label}`);
      if (!child.isFile && child.children.size > 0) {
        renderChildren(child, prefix + (isLast ? '    ' : '│   '));
      }
    });
  }

  renderChildren(root, '');
  return lines.join('\n');
}

/**
 * Extracts unique HTTPS external CDN script, stylesheet, and font URLs from HTML and CSS files.
 */
export function extractCdnDependencies(files: ReadmeFileInput[]): string[] {
  const urls = new Set<string>();

  const htmlAttrRegex =
    /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](https:\/\/[^"'\s>]+)["'][^>]*>/gi;
  const cssImportRegex =
    /@import\s+(?:url\(\s*["']?(https:\/\/[^"'\s)]+)["']?\s*\)|["'](https:\/\/[^"'\s]+)["'])/gi;

  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      let match: RegExpExecArray | null;
      htmlAttrRegex.lastIndex = 0;
      while ((match = htmlAttrRegex.exec(file.content)) !== null) {
        if (match[1]) urls.add(match[1]);
      }
    } else if (lower.endsWith('.css')) {
      let match: RegExpExecArray | null;
      cssImportRegex.lastIndex = 0;
      while ((match = cssImportRegex.exec(file.content)) !== null) {
        const url = match[1] || match[2];
        if (url) urls.add(url);
      }
    }
  }

  return Array.from(urls).sort((a, b) => a.localeCompare(b));
}

/**
 * Detects whether the project relies on ES module scripts (`type="module"` or JS ES imports).
 */
export function detectEsModules(files: ReadmeFileInput[]): boolean {
  for (const file of files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.mjs')) {
      return true;
    }
    if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      if (/<script\b[^>]*\btype\s*=\s*["']?module["']?/i.test(file.content)) {
        return true;
      }
    }
    if (lower.endsWith('.js')) {
      if (/^\s*(?:import|export)\s/m.test(file.content)) {
        return true;
      }
    }
  }
  return false;
}

export function generateProjectReadme(
  project: { title: string; idea?: string },
  files: ReadmeFileInput[]
): string {
  const title = project.title.trim() || 'Static Web App';
  const idea = project.idea?.trim();

  const sortedPaths = files
    .map((f) => f.path)
    .filter((p) => !p.startsWith('.desyra/'))
    .sort((a, b) => a.localeCompare(b));

  const treeText = buildAsciiTree(sortedPaths.length > 0 ? sortedPaths : ['index.html']);
  const usesEsModules = detectEsModules(files);
  const cdnUrls = extractCdnDependencies(files);

  const sections: string[] = [];

  sections.push(`# ${title}`);
  if (idea) {
    sections.push(idea);
  }

  sections.push(`## Project Structure\n\n\`\`\`text\n${treeText}\n\`\`\``);

  if (usesEsModules) {
    sections.push(
      `## How to Run Locally\n\n` +
        `This project uses ES module scripts (\`type="module"\`). Modern browsers block ES module imports over \`file://\` URLs due to CORS security rules, so serve the folder over HTTP instead of double-clicking \`index.html\`:\n\n` +
        `\`\`\`bash\n` +
        `# Option 1: Node.js\nnpx serve .\n\n` +
        `# Option 2: Python 3\npython3 -m http.server 8080\n` +
        `\`\`\`\n\n` +
        `Then open \`http://localhost:3000\` (or \`http://localhost:8080\`) in your browser.`
    );
  } else {
    sections.push(
      `## How to Run Locally\n\n` +
        `Open \`index.html\` directly in any web browser, or run a lightweight local static server:\n\n` +
        `\`\`\`bash\n` +
        `npx serve .\n` +
        `# or\n` +
        `python3 -m http.server 8080\n` +
        `\`\`\``
    );
  }

  if (cdnUrls.length > 0) {
    const list = cdnUrls.map((u) => `- ${u}`).join('\n');
    sections.push(
      `## External CDN Dependencies\n\n` +
        `An active internet connection is required for the following CDN stylesheets, fonts, or libraries referenced in the project:\n\n` +
        `${list}`
    );
  }

  sections.push(
    `## Deploying Online\n\n` +
      `This is a static web bundle with no server build step required:\n` +
      `- **Netlify Drop**: Drag and drop this folder onto app.netlify.com/drop.\n` +
      `- **Vercel**: Run \`npx vercel --prod\` inside the extracted folder.\n` +
      `- **GitHub Pages**: Push files to a repository and enable Pages on the root folder.\n` +
      `- **Cloudflare Pages**: Upload the folder directly in the dashboard.`
  );

  sections.push(`---\n\nBuilt with DESYRA`);

  return sections.join('\n\n') + '\n';
}
